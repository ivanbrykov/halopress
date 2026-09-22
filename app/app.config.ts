export default defineAppConfig({
  ui: {
    colors: {
      primary: 'purple',
      neutral: 'zinc'
    },
    button: {
      slots: {
        base: 'disabled:opacity-50 aria-disabled:opacity-50'
      }
    }
  }
})
