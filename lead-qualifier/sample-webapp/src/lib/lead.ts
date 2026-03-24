export interface LeadProfile {
  name: string
  email: string
  company: string
}

const STORAGE_KEY = 'lead-qualifier-frontend-codex.lead'

function sanitizeLeadProfile(profile: Partial<LeadProfile>): LeadProfile {
  return {
    name: profile.name?.trim() ?? '',
    email: profile.email?.trim() ?? '',
    company: profile.company?.trim() ?? '',
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }

  return (hash >>> 0).toString(16)
}

export function buildLeadUserId(email: string): string {
  return `lead_${fnv1a(normalizeEmail(email))}`
}

export function loadLeadProfile(): LeadProfile {
  if (typeof window === 'undefined') {
    return sanitizeLeadProfile({})
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return sanitizeLeadProfile({})
    }

    return sanitizeLeadProfile(JSON.parse(raw) as Partial<LeadProfile>)
  } catch {
    return sanitizeLeadProfile({})
  }
}

export function persistLeadProfile(profile: LeadProfile): void {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeLeadProfile(profile)))
}

export function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function validateWorkEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

export function buildInitialActionPayload(lead: LeadProfile, projectId: string) {
  const cleanName = lead.name.trim()
  const cleanEmail = normalizeEmail(lead.email)
  const cleanCompany = lead.company.trim()
  const timezone = getBrowserTimezone()

  // Bonsai ignores extra client-command parameters, so the payload intentionally
  // includes a few common aliases to survive unknown action parameter naming.
  return {
    name: cleanName,
    full_name: cleanName,
    fullName: cleanName,
    mail: cleanEmail,
    email: cleanEmail,
    work_email: cleanEmail,
    workEmail: cleanEmail,
    company: cleanCompany,
    company_name: cleanCompany,
    companyName: cleanCompany,
    user: {
      name: cleanName,
      email: cleanEmail,
      company: cleanCompany,
      company_name: cleanCompany,
      companyName: cleanCompany,
    },
    lead: {
      name: cleanName,
      email: cleanEmail,
      company: cleanCompany,
    },
    project_id: projectId,
    projectId: projectId,
    timezone,
    source: 'lead-qualifier-frontend-codex',
    submitted_via: 'lead-qualifier-frontend-codex',
  }
}
