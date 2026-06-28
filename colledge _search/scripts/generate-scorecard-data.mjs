import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const API_KEY = process.env.COLLEGE_SCORECARD_API_KEY || "DEMO_KEY";
const API_BASE = "https://api.data.gov/ed/collegescorecard/v1/schools";
const WIKIPEDIA_BASE = "https://en.wikipedia.org/api/rest_v1/page/summary/";
const COMMONS_API_BASE = "https://commons.wikimedia.org/w/api.php";
const WIKIDATA_SPARQL_BASE = "https://query.wikidata.org/sparql";
const USER_AGENT = "college-search-local/1.0";
const OUTPUT_FILE = resolve("scorecard-data.js");
const MAP_FILE = resolve("assets/us-map.svg");
const DEFAULT_CSV_FILE = resolve("tmp/scorecard-institution/Most-Recent-Cohorts-Institution.csv");
const INCLUDE_IMAGES = process.argv.includes("--images");
const SKIP_GENERIC_IMAGES = process.argv.includes("--no-generic-images");

const stateNamesByCode = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
};

const stateIdsByCode = Object.fromEntries(
  Object.entries(stateNamesByCode).map(([code, name]) => [code, slugState(name)]),
);

const ivyNames = new Set([
  "Brown University",
  "Columbia University in the City of New York",
  "Cornell University",
  "Dartmouth College",
  "Harvard University",
  "Princeton University",
  "University of Pennsylvania",
  "Yale University",
]);

const programFields = {
  agriculture: "Agriculture",
  resources: "Natural Resources",
  architecture: "Architecture",
  communication: "Communication",
  communications_technology: "Media Technology",
  computer: "Computer Science",
  education: "Education",
  engineering: "Engineering",
  engineering_technology: "Engineering Technology",
  language: "Languages",
  legal: "Legal Studies",
  english: "English",
  humanities: "Humanities",
  biological: "Biological Sciences",
  mathematics: "Mathematics",
  multidiscipline: "Interdisciplinary Studies",
  parks_recreation_fitness: "Kinesiology & Recreation",
  philosophy_religious: "Philosophy & Religion",
  physical_science: "Physical Sciences",
  psychology: "Psychology",
  security_law_enforcement: "Criminal Justice",
  public_administration_social_service: "Public Service",
  social_science: "Social Sciences",
  visual_performing: "Visual & Performing Arts",
  health: "Health Professions",
  business_marketing: "Business",
  history: "History",
};

const csvProgramFields = {
  PCIP01: "agriculture",
  PCIP03: "resources",
  PCIP04: "architecture",
  PCIP09: "communication",
  PCIP10: "communications_technology",
  PCIP11: "computer",
  PCIP13: "education",
  PCIP14: "engineering",
  PCIP15: "engineering_technology",
  PCIP16: "language",
  PCIP22: "legal",
  PCIP23: "english",
  PCIP24: "humanities",
  PCIP26: "biological",
  PCIP27: "mathematics",
  PCIP30: "multidiscipline",
  PCIP31: "parks_recreation_fitness",
  PCIP38: "philosophy_religious",
  PCIP40: "physical_science",
  PCIP42: "psychology",
  PCIP43: "security_law_enforcement",
  PCIP44: "public_administration_social_service",
  PCIP45: "social_science",
  PCIP50: "visual_performing",
  PCIP51: "health",
  PCIP52: "business_marketing",
  PCIP54: "history",
};

const fallbackCampusImages = [
  {
    image: "https://images.unsplash.com/photo-1523050854058-8df90110c9f1?auto=format&fit=crop&w=1000&q=80",
    imageSource: "https://unsplash.com/photos/person-writing-on-white-paper-8dE3lS8_f_8",
  },
  {
    image: "https://images.unsplash.com/photo-1562774053-701939374585?auto=format&fit=crop&w=1000&q=80",
    imageSource: "https://unsplash.com/photos/low-angle-photo-of-university-building-xdWkFaHI97c",
  },
  {
    image: "https://images.unsplash.com/photo-1498243691581-b145c3f54a5a?auto=format&fit=crop&w=1000&q=80",
    imageSource: "https://unsplash.com/photos/brown-wooden-book-shelf-lUaaKCUANVI",
  },
  {
    image: "https://images.unsplash.com/photo-1580582932707-520aed937b7b?auto=format&fit=crop&w=1000&q=80",
    imageSource: "https://unsplash.com/photos/brown-concrete-building-under-blue-sky-PILtrl9jkd8",
  },
  {
    image: "https://images.unsplash.com/photo-1541339907198-e08756dedf3f?auto=format&fit=crop&w=1000&q=80",
    imageSource: "https://unsplash.com/photos/people-walking-on-hallway-during-daytime-EeS69TTPQ18",
  },
];

const scorecardFields = [
  "id",
  "school.name",
  "school.city",
  "school.state",
  "school.ownership",
  "school.school_url",
  "location.lat",
  "location.lon",
  "latest.admissions.admission_rate.overall",
  "latest.cost.tuition.in_state",
  "latest.cost.tuition.out_of_state",
  "latest.cost.attendance.academic_year",
  "latest.cost.roomboard.oncampus",
  "latest.student.size",
  ...Object.keys(programFields).map((field) => `latest.academics.program_percentage.${field}`),
];

function slugState(name) {
  return name.toLowerCase().replaceAll(" ", "-");
}

function slugSchool(name) {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeMatchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|and|of|at|in|for|main|campus)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getNameKeys(name) {
  const keys = new Set([normalizeMatchText(name)]);
  if (name.includes("-")) {
    keys.add(normalizeMatchText(name.split("-")[0]));
  }
  keys.delete("");
  return [...keys];
}

function getSignificantTokens(college) {
  const ignored = new Set([
    "the",
    "and",
    "of",
    "at",
    "in",
    "for",
    "college",
    "university",
    "school",
    "institute",
    "institution",
    "state",
    "main",
    "campus",
    "online",
  ]);

  return normalizeMatchText(`${college.name} ${college.city}`)
    .split(" ")
    .filter((token) => token.length > 2 && !ignored.has(token));
}

function getAcronym(name) {
  return String(name || "")
    .replace(/&/g, " ")
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => /^[A-Za-z]/.test(word) && !/^(the|of|at|and|in|for)$/i.test(word))
    .map((word) => word[0].toUpperCase())
    .join("");
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return "Not published";
  return new Intl.NumberFormat("en-US").format(value);
}

function formatCurrency(value) {
  if (!Number.isFinite(value)) return "";
  return `$${formatNumber(value)}`;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "Not published";
  const percent = value * 100;
  const digits = percent > 0 && percent < 10 ? 1 : 0;
  return `${percent.toFixed(digits).replace(/\.0$/, "")}%`;
}

function normalizedUrl(value) {
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

function toNumber(value) {
  if (value === undefined || value === null || value === "" || value === "NA" || value === "PS") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function scorecardUrl(raw) {
  return `https://collegescorecard.ed.gov/school/?${raw.id}-${slugSchool(raw["school.name"])}`;
}

function schoolType(raw) {
  const ownership = raw["school.ownership"];
  const base = ownership === 1 ? "Public" : "Private nonprofit";
  const kind = /university/i.test(raw["school.name"]) ? "university" : "college";
  return `${base} four-year ${kind}`;
}

function buildPrograms(raw) {
  const programs = Object.entries(programFields)
    .map(([field, label]) => ({
      label,
      value: raw[`latest.academics.program_percentage.${field}`] || 0,
    }))
    .filter((program) => program.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 8)
    .map((program) => program.label);

  return programs.length ? programs : ["Broad Undergraduate Programs"];
}

function shouldKeepSchool(raw) {
  const name = raw["school.name"] || "";
  const stateCode = raw["school.state"];

  if (!stateNamesByCode[stateCode]) return false;
  if (stateCode === "CA") return false;
  if (ivyNames.has(name)) return false;
  if (/community college|junior college/i.test(name)) return false;

  return true;
}

function normalizeSchool(raw) {
  const stateCode = raw["school.state"];
  const stateName = stateNamesByCode[stateCode];
  const rate = raw["latest.admissions.admission_rate.overall"];
  const tuition = raw["latest.cost.tuition.in_state"];
  const outOfStateTuition = raw["latest.cost.tuition.out_of_state"];
  const roomBoard = raw["latest.cost.roomboard.oncampus"];
  const attendance = raw["latest.cost.attendance.academic_year"];
  const studentSize = raw["latest.student.size"];
  const programs = buildPrograms(raw);
  const type = schoolType(raw);
  const schoolUrl = normalizedUrl(raw["school.school_url"]);
  const sourceUrl = scorecardUrl(raw);
  const admissionRate = Number.isFinite(rate) ? Number((rate * 100).toFixed(1)) : null;
  const tuitionDisplay = formatCurrency(tuition);
  const roomBoardDisplay = formatCurrency(roomBoard);
  const attendanceDisplay = formatCurrency(attendance);

  return {
    id: `scorecard-${raw.id}`,
    scorecardId: raw.id,
    name: raw["school.name"],
    shortName: raw["school.name"],
    city: raw["school.city"],
    stateName,
    stateCode,
    region: stateName,
    founded: "Not published",
    type,
    admission: {
      year: "Latest Scorecard",
      rate: admissionRate,
      displayRate: formatPercent(rate),
      applicants: "Not published",
      admitted: "Not published",
      enrolled: formatNumber(studentSize),
    },
    coordinates: {
      lat: raw["location.lat"],
      lon: raw["location.lon"],
    },
    cost: {
      year: "Latest Scorecard",
      tuition: tuitionDisplay,
      tuitionNumeric: Number.isFinite(tuition) ? tuition : null,
      outOfStateTuition: formatCurrency(outOfStateTuition),
      onCampusHousingFood: roomBoardDisplay,
      totalResident: attendanceDisplay,
      note: "Generated from College Scorecard latest available institution data.",
      sourceUrl,
    },
    image: "",
    imageAlt: `${raw["school.name"]} campus image`,
    imageSource: sourceUrl,
    summary:
      `${raw["school.name"]} is a ${type.toLowerCase()} in ${raw["school.city"]}, ${stateName}. ` +
      `College Scorecard lists it as bachelor's-predominant, with ${formatPercent(rate).toLowerCase()} admission, ` +
      `${tuitionDisplay || "not-published"} tuition, and ${formatNumber(studentSize).toLowerCase()} undergraduates.`,
    programs,
    fit: [
      `Students looking for a ${type.toLowerCase()} in ${stateName}`,
      `Applicants interested in ${programs.slice(0, 3).join(", ")}`,
      "Students comparing admission rate, tuition, housing/food cost, and location across four-year colleges",
    ],
    sourceUrl,
    programsUrl: schoolUrl || sourceUrl,
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed ${response.status}: ${url}`);
  }

  return response.json();
}

async function fetchScorecardSchools() {
  const schools = [];
  let page = 0;
  let total = Infinity;

  while (schools.length < total) {
    const params = new URLSearchParams({
      api_key: API_KEY,
      "school.operating": "1",
      "school.degrees_awarded.predominant": "3",
      "school.ownership": "1,2",
      per_page: "100",
      page: String(page),
      fields: scorecardFields.join(","),
    });
    const json = await fetchJson(`${API_BASE}?${params}`);
    total = json.metadata.total;
    schools.push(...json.results);
    page += 1;
    console.log(`Fetched ${schools.length}/${total} Scorecard schools`);
  }

  return schools;
}

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      value += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(value);
      value = "";
      continue;
    }

    value += char;
  }

  values.push(value);
  return values;
}

function csvRowToRaw(row) {
  const raw = {
    id: toNumber(row.UNITID),
    "school.name": row.INSTNM,
    "school.city": row.CITY,
    "school.state": row.STABBR,
    "school.ownership": toNumber(row.CONTROL),
    "school.school_url": row.INSTURL,
    "school.degrees_awarded.predominant": toNumber(row.PREDDEG),
    "school.operating": toNumber(row.CURROPER),
    "location.lat": toNumber(row.LATITUDE),
    "location.lon": toNumber(row.LONGITUDE),
    "latest.admissions.admission_rate.overall": toNumber(row.ADM_RATE),
    "latest.cost.tuition.in_state": toNumber(row.TUITIONFEE_IN),
    "latest.cost.tuition.out_of_state": toNumber(row.TUITIONFEE_OUT),
    "latest.cost.attendance.academic_year": toNumber(row.COSTT4_A),
    "latest.cost.roomboard.oncampus": toNumber(row.ROOMBOARD_ON),
    "latest.student.size": toNumber(row.UGDS),
  };

  for (const [csvField, apiField] of Object.entries(csvProgramFields)) {
    raw[`latest.academics.program_percentage.${apiField}`] = toNumber(row[csvField]) || 0;
  }

  return raw;
}

function loadScorecardCsv(filePath) {
  const csv = readFileSync(filePath, "utf8");
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0]);

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || "";
    });
    return csvRowToRaw(row);
  });
}

async function loadScorecardSchools() {
  if (existsSync(DEFAULT_CSV_FILE)) {
    console.log(`Reading Scorecard CSV from ${DEFAULT_CSV_FILE}`);
    return loadScorecardCsv(DEFAULT_CSV_FILE);
  }

  return fetchScorecardSchools();
}

function isUsableImage(url) {
  if (!url) return false;
  const decoded = decodeURIComponent(url).toLowerCase();
  return !/(seal|logo|wordmark|athletic|mascot|emblem|crest|icon|brandmark|favicon|sprite)/.test(decoded);
}

function commonsFileUrl(fileName) {
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fileName)}?width=960`;
}

function parseHtmlAttributes(source) {
  const attributes = {};
  const attrPattern = /([:\w-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+)/g;
  let match;

  while ((match = attrPattern.exec(source))) {
    const [, key, rawValue] = match;
    attributes[key.toLowerCase()] = rawValue.replace(/^["']|["']$/g, "");
  }

  return attributes;
}

function extractMetaImages(html, baseUrl) {
  const images = [];
  const metaPattern = /<meta\s+[^>]*>/gi;
  let match;

  while ((match = metaPattern.exec(html))) {
    const attrs = parseHtmlAttributes(match[0]);
    const key = (attrs.property || attrs.name || "").toLowerCase();
    if (!["og:image", "og:image:url", "twitter:image", "twitter:image:src"].includes(key)) continue;
    const content = attrs.content;
    if (!content) continue;

    try {
      images.push(new URL(content, baseUrl).href);
    } catch {
      // Ignore malformed image URLs.
    }
  }

  return images;
}

async function fetchWikipediaImage(college) {
  const url = `${WIKIPEDIA_BASE}${encodeURIComponent(college.name)}`;

  try {
    const json = await fetchJson(url);
    const image = json.thumbnail?.source || json.originalimage?.source || "";
    if (!isUsableImage(image)) return college;

    return {
      ...college,
      image,
      imageAlt: json.title ? `${json.title} image from Wikipedia` : college.imageAlt,
      imageSource: json.content_urls?.desktop?.page || college.imageSource,
    };
  } catch {
    return college;
  }
}

async function fetchOfficialImage(college) {
  const url = college.programsUrl;
  if (!url || !/^https?:\/\//i.test(url)) return college;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
      },
      redirect: "follow",
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return college;

    const html = await response.text();
    const image = extractMetaImages(html, response.url).find(isUsableImage);
    if (!image) return college;

    return {
      ...college,
      image,
      imageAlt: `${college.name} campus or homepage image`,
      imageSource: response.url,
    };
  } catch {
    return college;
  }
}

function buildWikidataImageQuery() {
  return `
    SELECT ?item ?itemLabel ?image ?article WHERE {
      ?item wdt:P31/wdt:P279* wd:Q3918;
            wdt:P17 wd:Q30.
      OPTIONAL { ?item wdt:P18 ?image. }
      OPTIONAL {
        ?article schema:about ?item;
                 schema:isPartOf <https://en.wikipedia.org/>.
      }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
  `;
}

async function fetchWikidataImages() {
  const url = `${WIKIDATA_SPARQL_BASE}?query=${encodeURIComponent(buildWikidataImageQuery())}&format=json`;
  const json = await fetchJson(url);
  const imagesByName = new Map();

  for (const binding of json.results?.bindings || []) {
    const label = binding.itemLabel?.value;
    const image = binding.image?.value?.replace(/^http:/, "https:");
    if (!label || !isUsableImage(image)) continue;

    const record = {
      image: image.includes("Special:FilePath/") ? `${image}?width=960` : image,
      imageSource: binding.article?.value || binding.item?.value || image,
    };

    for (const key of getNameKeys(label)) {
      if (!imagesByName.has(key)) imagesByName.set(key, record);
    }
  }

  return imagesByName;
}

function applyWikidataImages(colleges, imagesByName) {
  let applied = 0;

  const nextColleges = colleges.map((college) => {
    if (college.image) return college;
    const match = getNameKeys(college.name).map((key) => imagesByName.get(key)).find(Boolean);
    if (!match) return college;
    applied += 1;
    return {
      ...college,
      image: match.image,
      imageAlt: `${college.name} campus image`,
      imageSource: match.imageSource,
    };
  });

  console.log(`Applied ${applied} Wikidata images`);
  return nextColleges;
}

function scoreCommonsCandidate(college, page) {
  const title = page.title || "";
  const titleMatch = normalizeMatchText(title.replace(/^File:/, ""));
  const fullName = normalizeMatchText(college.name);
  const city = normalizeMatchText(college.city);
  const tokens = getSignificantTokens(college);
  const acronym = getAcronym(college.name).toLowerCase();
  let score = 0;

  if (!isUsableImage(page.url) || !isUsableImage(title)) return -100;
  if (page.mime && !String(page.mime).startsWith("image/")) return -100;
  if (fullName && titleMatch.includes(fullName)) score += 24;
  if (acronym.length > 2 && titleMatch.includes(acronym)) score += 10;
  if (city && titleMatch.includes(city)) score += 3;

  for (const token of tokens) {
    if (titleMatch.includes(token)) score += token.length > 5 ? 4 : 2;
  }

  if (/\b(campus|quad|hall|building|library|center|university|college)\b/.test(titleMatch)) score += 3;
  if (/\b(map|diagram|chart|poster|seal|logo|wordmark|emblem|crest)\b/.test(titleMatch)) score -= 10;

  return score;
}

async function fetchCommonsImage(college) {
  const queries = [
    `${college.name} campus`,
    `${college.name} ${college.city}`,
    `${college.name} university building`,
  ];
  const seen = new Set();
  let best = null;

  for (const query of queries) {
    const params = new URLSearchParams({
      action: "query",
      generator: "search",
      gsrnamespace: "6",
      gsrsearch: query,
      gsrlimit: "8",
      prop: "imageinfo",
      iiprop: "url|mime",
      iiurlwidth: "960",
      format: "json",
      origin: "*",
    });

    try {
      const json = await fetchJson(`${COMMONS_API_BASE}?${params}`);
      for (const page of Object.values(json.query?.pages || {})) {
        if (seen.has(page.title)) continue;
        seen.add(page.title);
        const info = page.imageinfo?.[0];
        if (!info) continue;
        const candidate = {
          title: page.title,
          url: info.thumburl || info.url,
          mime: info.mime,
          imageSource: `https://commons.wikimedia.org/wiki/${page.title.replaceAll(" ", "_")}`,
        };
        const score = scoreCommonsCandidate(college, candidate);
        if (!best || score > best.score) best = { ...candidate, score };
      }
    } catch {
      // Keep going; this is an enrichment pass.
    }
  }

  if (!best || best.score < 8) return college;

  return {
    ...college,
    image: best.url,
    imageAlt: `${college.name} campus image`,
    imageSource: best.imageSource,
  };
}

function applyGenericCampusImages(colleges) {
  let applied = 0;
  const nextColleges = colleges.map((college, index) => {
    if (college.image) return college;
    const fallback = fallbackCampusImages[index % fallbackCampusImages.length];
    applied += 1;
    return {
      ...college,
      image: fallback.image,
      imageAlt: `${college.name} campus-style image`,
      imageSource: fallback.imageSource,
      generatedImageFallback: true,
    };
  });

  console.log(`Applied ${applied} generic campus fallback images`);
  return nextColleges;
}

async function mapWithLimit(items, limit, mapper, label = "items") {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
      if ((index + 1) % 100 === 0 || index + 1 === items.length) {
        console.log(`Checked ${index + 1}/${items.length} ${label}`);
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

function parseSvgPathBoxes() {
  const svg = readFileSync(MAP_FILE, "utf8");
  const boxes = {};
  const pathPattern = /<path class="([a-z]{2})" d="([^"]+)"/g;
  let match;

  while ((match = pathPattern.exec(svg))) {
    const [, code, path] = match;
    boxes[code] = parsePathBox(path);
  }

  return boxes;
}

function parsePathBox(path) {
  const tokens = path.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/g) || [];
  let index = 0;
  let command = "";
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const isCommand = (token) => /^[a-zA-Z]$/.test(token);
  const readNumber = () => Number(tokens[index++]);
  const addPoint = (nextX, nextY) => {
    x = nextX;
    y = nextY;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  const readPoint = (relative) => {
    const nextX = readNumber();
    const nextY = readNumber();
    return relative ? [x + nextX, y + nextY] : [nextX, nextY];
  };

  while (index < tokens.length) {
    if (isCommand(tokens[index])) {
      command = tokens[index++];
    }

    const relative = command === command.toLowerCase();
    const lower = command.toLowerCase();

    if (lower === "z") {
      addPoint(startX, startY);
      continue;
    }

    if (lower === "m") {
      const point = readPoint(relative);
      addPoint(point[0], point[1]);
      startX = x;
      startY = y;
      command = relative ? "l" : "L";

      while (index < tokens.length && !isCommand(tokens[index])) {
        const linePoint = readPoint(relative);
        addPoint(linePoint[0], linePoint[1]);
      }
      continue;
    }

    if (lower === "l") {
      while (index < tokens.length && !isCommand(tokens[index])) {
        const point = readPoint(relative);
        addPoint(point[0], point[1]);
      }
      continue;
    }

    if (lower === "h") {
      while (index < tokens.length && !isCommand(tokens[index])) {
        const value = readNumber();
        addPoint(relative ? x + value : value, y);
      }
      continue;
    }

    if (lower === "v") {
      while (index < tokens.length && !isCommand(tokens[index])) {
        const value = readNumber();
        addPoint(x, relative ? y + value : value);
      }
      continue;
    }

    const pointCounts = { c: 3, s: 2, q: 2, t: 1, a: 1 };
    const count = pointCounts[lower] || 0;
    if (count) {
      while (index < tokens.length && !isCommand(tokens[index])) {
        if (lower === "a") {
          index += 5;
        }
        for (let i = 0; i < count; i += 1) {
          const point = readPoint(relative);
          addPoint(point[0], point[1]);
        }
      }
      continue;
    }

    index += 1;
  }

  return {
    x: Math.round(minX * 10) / 10,
    y: Math.round(minY * 10) / 10,
    width: Math.round((maxX - minX) * 10) / 10,
    height: Math.round((maxY - minY) * 10) / 10,
  };
}

function groupByState(colleges) {
  return colleges.reduce((groups, college) => {
    const stateId = stateIdsByCode[college.stateCode];
    if (!stateId) return groups;
    groups[stateId] ||= [];
    groups[stateId].push(college);
    return groups;
  }, {});
}

function writeDataFile(groupedColleges, mapBoxes, sourceTotal, keptTotal) {
  const source = {
    sourceName: "College Scorecard",
    sourceUrl: "https://collegescorecard.ed.gov/data/",
    apiUrl: "https://api.data.gov/ed/collegescorecard/v1/schools",
    downloadedAt: new Date().toISOString(),
    filter:
      "Operating, bachelor's-predominant, public or private nonprofit institutions; California and Ivy League schools are handled by curated data; community/junior colleges filtered by name.",
    sourceTotal,
    keptTotal,
  };

  const output =
    `const scorecardDataSource = ${JSON.stringify(source, null, 2)};\n\n` +
    `const scorecardStateMapBoxes = ${JSON.stringify(mapBoxes, null, 2)};\n\n` +
    `const scorecardStateColleges = ${JSON.stringify(groupedColleges, null, 2)};\n`;

  writeFileSync(OUTPUT_FILE, output);
}

const rawSchools = await loadScorecardSchools();
let colleges = rawSchools
  .filter((raw) => raw["school.operating"] === 1)
  .filter((raw) => raw["school.degrees_awarded.predominant"] === 3)
  .filter((raw) => raw["school.ownership"] === 1 || raw["school.ownership"] === 2)
  .filter(shouldKeepSchool)
  .map(normalizeSchool);

if (INCLUDE_IMAGES) {
  const wikidataImages = await fetchWikidataImages();
  colleges = applyWikidataImages(colleges, wikidataImages);
  colleges = await mapWithLimit(
    colleges,
    6,
    (college) => (college.image ? college : fetchCommonsImage(college)),
    "Wikimedia Commons images",
  );
  colleges = await mapWithLimit(
    colleges,
    8,
    (college) => (college.image ? college : fetchWikipediaImage(college)),
    "Wikipedia images",
  );
  colleges = await mapWithLimit(
    colleges,
    10,
    (college) => (college.image ? college : fetchOfficialImage(college)),
    "official homepage images",
  );
}

if (!SKIP_GENERIC_IMAGES) {
  colleges = applyGenericCampusImages(colleges);
}

const groupedColleges = groupByState(colleges);
const mapBoxes = parseSvgPathBoxes();
writeDataFile(groupedColleges, mapBoxes, rawSchools.length, colleges.length);
console.log(`Wrote ${colleges.length} generated colleges to ${OUTPUT_FILE}`);
