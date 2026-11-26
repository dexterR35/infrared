// Industry profiles change only defaults and wording. The tracking SDK, feature pipeline,
// model families and privacy rules are identical for every website.
import {businessGoals} from './business-goals.js';
import {semanticElementTypes} from './element-types.js';

type Goal = (typeof businessGoals)[number];
type ElementType = (typeof semanticElementTypes)[number];
export type IndustryProfile = {
  id: string;
  label: string;
  aliases: readonly string[];
  goals: readonly Goal[];
  elements: readonly ElementType[];
  // Regulated verticals keep analysis on aggregate design and usability.
  regulated: boolean;
};

export const industryProfiles: readonly IndustryProfile[] = [
  {id: 'financial', label: 'Financial services', aliases: ['finance', 'financial', 'credit', 'credits', 'loan', 'loans', 'bank', 'banking', 'insurance', 'mortgage', 'fintech'], goals: ['loan_application', 'quote_requested', 'lead_generated'], elements: ['calculator', 'form', 'offer', 'button', 'pricing'], regulated: true},
  {id: 'gaming', label: 'Casino and gaming', aliases: ['casino', 'gaming', 'igaming', 'betting', 'sportsbook', 'poker', 'bingo', 'lottery'], goals: ['registration_completed', 'registration', 'qualified_acquisition'], elements: ['game_card', 'banner', 'offer', 'navigation', 'button'], regulated: true},
  {id: 'fashion', label: 'Fashion', aliases: ['fashion', 'clothing', 'clothes', 'apparel', 'shoes', 'footwear', 'accessories', 'beauty'], goals: ['purchase', 'add_to_cart'], elements: ['product_card', 'filter', 'image', 'button', 'search'], regulated: false},
  {id: 'ecommerce', label: 'E-commerce', aliases: ['ecommerce', 'e-commerce', 'shop', 'store', 'retail', 'marketplace', 'electronics', 'grocery'], goals: ['purchase', 'add_to_cart'], elements: ['product_card', 'search', 'filter', 'offer', 'button'], regulated: false},
  {id: 'real_estate', label: 'Real estate', aliases: ['real-estate', 'real_estate', 'realestate', 'property', 'properties', 'housing', 'rental'], goals: ['lead_generated', 'appointment_booked'], elements: ['product_card', 'image', 'form', 'filter', 'search'], regulated: false},
  {id: 'automotive', label: 'Automotive', aliases: ['automotive', 'auto', 'cars', 'car', 'vehicles', 'dealership'], goals: ['appointment_booked', 'quote_requested', 'lead_generated'], elements: ['product_card', 'calculator', 'form', 'image', 'filter'], regulated: false},
  {id: 'saas', label: 'SaaS', aliases: ['saas', 'software', 'app', 'platform', 'b2b'], goals: ['trial_started', 'subscription', 'lead_generated'], elements: ['pricing', 'button', 'form', 'video', 'navigation'], regulated: false},
  {id: 'healthcare', label: 'Healthcare', aliases: ['healthcare', 'health', 'clinic', 'medical', 'dental', 'pharmacy', 'wellness'], goals: ['appointment_booked', 'lead_generated'], elements: ['form', 'button', 'navigation', 'search'], regulated: true},
  {id: 'travel', label: 'Travel', aliases: ['travel', 'hotel', 'hotels', 'flights', 'tourism', 'holiday', 'vacation', 'booking'], goals: ['booking_completed', 'purchase'], elements: ['product_card', 'search', 'filter', 'offer', 'image'], regulated: false},
  {id: 'media', label: 'News and media', aliases: ['media', 'news', 'publishing', 'magazine', 'video', 'streaming', 'podcast'], goals: ['subscription', 'registration'], elements: ['link', 'video', 'banner', 'button', 'navigation'], regulated: false},
  {id: 'education', label: 'Education', aliases: ['education', 'course', 'courses', 'school', 'university', 'learning', 'training', 'elearning'], goals: ['enrolment', 'lead_generated', 'trial_started'], elements: ['product_card', 'pricing', 'video', 'form', 'button'], regulated: false},
  {id: 'corporate', label: 'Corporate website', aliases: ['corporate', 'company', 'services', 'agency', 'consulting', 'portfolio'], goals: ['lead_generated', 'quote_requested', 'download_completed'], elements: ['form', 'button', 'navigation', 'link', 'video'], regulated: false},
];

const general: IndustryProfile = {id: 'general', label: 'General website', aliases: [], goals: ['lead_generated', 'custom_conversion'], elements: ['button', 'link', 'form', 'navigation'], regulated: false};

const byAlias = new Map(industryProfiles.flatMap((p) => p.aliases.map((a) => [a, p] as const)));

/** Resolve a free-form product label (registry "product") to a profile. Unknown labels use the general profile. */
export function industryFor(product: string | null | undefined): IndustryProfile {
  const key = (product ?? '').trim().toLowerCase();
  if (!key) return general;
  const exact = byAlias.get(key);
  if (exact) return exact;
  // Accept compound labels such as "fashion-store" or "casino_ro" by token.
  for (const token of key.split(/[^a-z0-9]+/)) {
    const match = byAlias.get(token);
    if (match) return match;
  }
  return general;
}

/** Order goals so the profile's recommendations come first; never removes a valid goal. */
export function rankGoals<T extends string>(goals: readonly T[], profile: IndustryProfile): {recommended: T[]; other: T[]} {
  const wanted = new Set<string>(profile.goals);
  const recommended = profile.goals.filter((g) => goals.includes(g as unknown as T)) as unknown as T[];
  return {recommended, other: goals.filter((g) => !wanted.has(g))};
}
