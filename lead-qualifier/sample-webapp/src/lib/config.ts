export interface RuntimeConfig {
  apiBaseUrl: string
  apiKey: string
  projectId: string
  entryStageId: string
  initialActionName: string
}

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function sanitizeConfig(config: RuntimeConfig): RuntimeConfig {
  return {
    apiBaseUrl: trimTrailingSlash(config.apiBaseUrl),
    apiKey: config.apiKey.trim(),
    projectId: config.projectId.trim(),
    entryStageId: config.entryStageId.trim(),
    initialActionName: config.initialActionName.trim(),
  }
}

export function getEnvRuntimeConfig(): RuntimeConfig {
  return sanitizeConfig({
    apiBaseUrl: import.meta.env.VITE_BONSAI_API_BASE_URL ?? '',
    apiKey: import.meta.env.VITE_BONSAI_API_KEY ?? '',
    projectId: import.meta.env.VITE_BONSAI_PROJECT_ID ?? '',
    entryStageId: import.meta.env.VITE_BONSAI_ENTRY_STAGE_ID ?? '',
    initialActionName: import.meta.env.VITE_BONSAI_INITIAL_ACTION ?? '',
  })
}

export function loadRuntimeConfig(): RuntimeConfig {
  return getEnvRuntimeConfig()
}
