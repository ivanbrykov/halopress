// @ts-check
import pluginVue from 'eslint-plugin-vue'
import withNuxt from './.nuxt/eslint.config.mjs'

const vueEssentialConfigs = pluginVue.configs['flat/essential']
const vueEssentialRules = vueEssentialConfigs.reduce((acc, config) => ({
  ...acc,
  ...(config.rules ?? {})
}), {})
const vueAllRulesOff = Object.fromEntries(
  Object.keys(pluginVue.rules || {}).map(rule => [`vue/${rule}`, 'off'])
)

export default withNuxt(
  ...vueEssentialConfigs,
  {
    name: 'vue/essential-only',
    rules: {
      ...vueAllRulesOff,
      ...vueEssentialRules
    }
  },
  {
    rules: {
      // MVP: allow faster iteration (tighten later).
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-dynamic-delete': 'off',
      '@stylistic/no-multiple-empty-lines': 'off',
      '@stylistic/member-delimiter-style': 'off',
      '@stylistic/operator-linebreak': 'off',
      '@stylistic/quote-props': 'off',
      '@stylistic/arrow-parens': 'off',
      '@stylistic/indent': 'off',
      '@stylistic/brace-style': 'off',
      'vue/no-mutating-props': 'off',
      'vue/multi-word-component-names': 'off',
      'nuxt/nuxt-config-keys-order': 'off'
    }
  }
)
