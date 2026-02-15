import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RULES_ROOT = path.resolve(__dirname, '../../frontend/rules');
const RULES_SUBDIR = 'rules';

const COUNTRY_TO_SLUG = {
  India: 'india',
  USA: 'usa',
  Canada: 'canada',
  Australia: 'australia',
  'New Zealand': 'new_zealand',
  GCC: 'gcc'
};

const COUNTRY_LABELS = {
  india: 'India',
  usa: 'USA',
  canada: 'Canada',
  australia: 'Australia',
  new_zealand: 'New Zealand',
  gcc: 'GCC'
};

const GCC_REGION_TO_SLUG = {
  'United Arab Emirates': 'uae',
  'Saudi Arabia': 'saudi_arabia',
  Kuwait: 'kuwait',
  Qatar: 'qatar',
  Bahrain: 'bahrain',
  Oman: 'oman'
};

const GCC_REGION_LABELS = {
  uae: 'United Arab Emirates',
  saudi_arabia: 'Saudi Arabia',
  kuwait: 'Kuwait',
  qatar: 'Qatar',
  bahrain: 'Bahrain',
  oman: 'Oman'
};

const CATEGORY_TO_SLUG = {
  Pharmaceuticals: 'pharmaceutical',
  HealthCare: 'healthcare',
  Insurance: 'insurance'
};

const slugToLabel = (slug) => {
  return slug
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
};

const safeReadJson = (filePath) => {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn(`[Rules] Failed to read ${filePath}: ${error.message}`);
    return [];
  }
};

const readRulesFromDir = (dirPath) => {
  if (!fs.existsSync(dirPath)) return [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(dirPath, entry.name));

  return files.flatMap((filePath) => safeReadJson(filePath));
};

export const getRulesMetadata = () => {
  const industries = Object.keys(CATEGORY_TO_SLUG).map((label) => ({
    id: CATEGORY_TO_SLUG[label],
    label
  }));

  const defaultCountries = [
    { id: 'india', label: 'India' },
    { id: 'usa', label: 'United States' },
    { id: 'canada', label: 'Canada' },
    { id: 'australia', label: 'Australia' },
    { id: 'gcc', label: 'GCC' },
    { id: 'new_zealand', label: 'New Zealand' }
  ];

  if (!fs.existsSync(RULES_ROOT)) {
    return { countries: defaultCountries, industries };
  }

  const nestedRulesRoot = path.join(RULES_ROOT, RULES_SUBDIR);
  const scanRoot = fs.existsSync(nestedRulesRoot) ? nestedRulesRoot : RULES_ROOT;

  const countryDirs = fs.readdirSync(scanRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  if (countryDirs.length === 0) {
    return { countries: defaultCountries, industries };
  }

  const countries = countryDirs.map((slug) => {
    if (slug === 'gcc') {
      const gccPath = path.join(scanRoot, 'gcc');
      const regionDirs = fs.readdirSync(gccPath, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => ({
          id: entry.name,
          label: GCC_REGION_LABELS[entry.name] || slugToLabel(entry.name)
        }));

      return { id: slug, label: COUNTRY_LABELS[slug] || 'GCC', regions: regionDirs };
    }

    return { id: slug, label: COUNTRY_LABELS[slug] || slugToLabel(slug), regions: [] };
  });

  return { countries, industries };
};

export const getRulesForSelection = ({ country, region, category }) => {
  const countrySlug = COUNTRY_TO_SLUG[country] || (country || '').toLowerCase();
  const categorySlug = CATEGORY_TO_SLUG[category] || 'pharmaceutical';

  if (!countrySlug) return [];

  const nestedRulesRoot = path.join(RULES_ROOT, RULES_SUBDIR);
  const scanRoot = fs.existsSync(nestedRulesRoot) ? nestedRulesRoot : RULES_ROOT;

  let basePath = path.join(scanRoot, countrySlug);

  if (countrySlug === 'gcc') {
    const regionSlug = GCC_REGION_TO_SLUG[region] || (region || '').toLowerCase();
    if (!regionSlug) return [];
    basePath = path.join(scanRoot, 'gcc', regionSlug);
  }

  if (!fs.existsSync(basePath)) return [];

  const rulePaths = [path.join(basePath, 'common'), path.join(basePath, categorySlug)];

  return rulePaths.flatMap((dirPath) => readRulesFromDir(dirPath));
};

export default {
  getRulesMetadata,
  getRulesForSelection
};
