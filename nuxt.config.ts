import { fileURLToPath } from 'node:url'

// https://nuxt.com/docs/api/configuration/nuxt-config
const isCloudflareBuild = process.env.WORKERS_CI === '1'
  || Boolean(process.env.CF_PAGES || process.env.CF_PAGES_URL)
const includeSiteMenuSsrFixture = process.env.HALOPRESS_SITE_MENU_SSR_FIXTURE === '1'
const imageProvider = process.env.NUXT_IMAGE_PROVIDER
  || (isCloudflareBuild ? 'cloudflare' : 'ipx')
const cloudflareBaseURL = process.env.NUXT_IMAGE_CLOUDFLARE_BASE_URL
const ipxAssetsAlias = process.env.NUXT_IPX_ALIAS_ASSETS || 'http://localhost:3000/assets'
const garuNodeEntry = fileURLToPath(import.meta.resolve('garu-ko'))
const garuModelAsset = fileURLToPath(import.meta.resolve('garu-ko/worker/model'))

export default defineNuxtConfig({
  modules: ['@nuxt/eslint', '@nuxt/ui', '@nuxt/image', '@sidebase/nuxt-auth'],

  devtools: {
    enabled: true
  },

  css: ['~/assets/css/main.css', '~/assets/css/site-document.css'],

  ui: {
    experimental: {
      componentDetection: true
    }
  },

  image: {
    provider: imageProvider,
    alias: imageProvider === 'ipx'
      ? { '/assets': ipxAssetsAlias }
      : {},
    cloudflare: cloudflareBaseURL ? { baseURL: cloudflareBaseURL } : {},
    presets: {
      avatar: {
        modifiers: {
          width: 96,
          height: 96,
          fit: 'cover'
        }
      },
      card: {
        modifiers: {
          width: 640,
          height: 480,
          fit: 'cover'
        }
      },
      content: {
        modifiers: {
          width: 1200,
          fit: 'inside'
        }
      }
    }
  },

  compatibilityDate: '2026-05-18',

  nitro: {
    preset: 'cloudflare-module',
    errorHandler: '~~/server/error-handler.ts',
    externals: {
      // The Node analyzer thread imports this package from an eval worker.
      // Trace it explicitly so a copied node-server output stays self-contained.
      traceInclude: [garuNodeEntry, garuModelAsset]
    }
  },

  hooks: {
    'pages:extend'(pages) {
      // The CI-only route renders the real Nuxt UI vertical Accordion without
      // exposing a test endpoint in normal development or production builds.
      if (!includeSiteMenuSsrFixture) return
      pages.push({
        name: 'site-menu-ssr-fixture',
        path: '/_site-menu-ssr-fixture',
        file: fileURLToPath(new URL('./tests/fixtures/SiteMenuNuxtSsrFixture.vue', import.meta.url))
      })
    },
    'nitro:config'(nitroConfig) {
      // Sidebase's production origin assertion runs at Worker startup without a request.
      // On Cloudflare Workers the canonical origin is available from each request host.
      nitroConfig.plugins = nitroConfig.plugins?.filter(
        plugin => plugin && !plugin.includes('@sidebase/nuxt-auth/dist/runtime/server/plugins/assertOrigin')
      )
    }
  },

  vite: {
    optimizeDeps: {
      exclude: ['garu-ko/browser'],
      include: [
        '@nuxt/ui > prosemirror-state',
        '@nuxt/ui > prosemirror-transform',
        '@nuxt/ui > prosemirror-model',
        '@nuxt/ui > prosemirror-view',
        '@nuxt/ui > prosemirror-gapcursor'
      ]
    }
  },

  runtimeConfig: {
    authSecret: 'dev-secret-change-me',
    authOrigin: 'http://localhost:3000/api/auth',
    canonicalOrigin: '',
    installToken: '',
    secretKey: '',
    oauthGoogleEncryptionKey: '',
    oauthSettingsSource: 'env+db',
    oauthProviders: '',
    oauthCredentialsEnabled: '',
    oauthGoogleEnabled: '',
    oauthGoogleClientId: '',
    oauthGoogleClientSecret: '',
    public: {
      keywordSearchMode: 'browser',
      keywordSearchBrowserFallback: true
    }
  },

  auth: {
    originEnvKey: 'NUXT_AUTH_ORIGIN',
    baseURL: '/api/auth',
    // Cloudflare Workers cannot make an HTTP request back to the same Worker.
    // Load the session in the browser after hydration instead of during SSR.
    disableServerSideAuth: true,
    provider: {
      type: 'authjs',
      trustHost: true,
      defaultProvider: 'credentials',
      addDefaultCallbackUrl: true
    },
    globalAppMiddleware: false
  },

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  }
})
