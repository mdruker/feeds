export enum Env {
  development = "development",
  staging = "staging",
  production = "production",
}

export function isDevelopment(): boolean {
  return process.env.ENVIRONMENT === Env.development
}

export function isProduction(): boolean {
  return process.env.ENVIRONMENT === Env.production
}

export function debugLog(message?: any, ...optionalParams: any[]) {
  if (!isProduction()) {
    if (optionalParams.length === 0) {
      console.log(message)
    } else {
      console.log(message, optionalParams)
    }
  }
}