const normalizeBaseUrl = (baseUrl) => {
  if (!baseUrl) {
    return ''
  }

  return baseUrl.trim().replace(/\/$/, '')
}

const getBaseUrl = () => {
  // Prefer runtime-injected env (window._env_) when available, then CRA build-time var
  if (typeof window !== 'undefined' && window._env_ && window._env_.REACT_APP_API_URL) {
    return normalizeBaseUrl(window._env_.REACT_APP_API_URL)
  }

  return normalizeBaseUrl(process.env.REACT_APP_API_URL)
}

export const apiUrl = (path) => {
  const baseUrl = getBaseUrl()
  const normalizedPath = path.startsWith('/') ? path : `/${path}`

  return baseUrl ? `${baseUrl}${normalizedPath}` : normalizedPath
}