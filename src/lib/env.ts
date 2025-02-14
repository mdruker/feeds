export enum Env {
  development = "development",
  staging = "staging",
  production = "production",
}

export function isDevelopment(): boolean {
  return process.env.ENVIRONMENT === Env.development
}

export function isStaging(): boolean {
  return process.env.ENVIRONMENT === Env.staging
}

export function isProduction(): boolean {
  return process.env.ENVIRONMENT === Env.production
}

export function debugLog(text: string) {
  if (isDevelopment()) {
    console.log(text)
  }
}

export function nonProductionLog(text: string) {
  if (!isProduction()) {
    console.log(text)
  }
}