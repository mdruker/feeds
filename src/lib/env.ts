export enum Env {
  development = "development",
  production = "production",
}

export function isDevelopment(): boolean {
  return process.env.ENVIRONMENT === Env.development
}

export function isProduction(): boolean {
  return process.env.ENVIRONMENT === Env.production
}

export function debugLog(text: string) {
  if (isDevelopment()) {
    console.log(text)
  }
}