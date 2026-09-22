import type { ButtonProps } from '@nuxt/ui'
import { LazyConfirmDialog } from '#components'

type ConfirmDialogOptions = {
  title?: string
  body?: string
  confirmLabel?: string
  cancelLabel?: string
  confirmColor?: ButtonProps['color']
  confirmVariant?: ButtonProps['variant']
}

export function useConfirmDialog() {
  const overlay = useOverlay()
  const modal = overlay.create(LazyConfirmDialog, {
    props: {
      title: 'Confirm',
      confirmLabel: 'Confirm',
      cancelLabel: 'Cancel',
      confirmColor: 'error',
      confirmVariant: 'solid'
    }
  })

  const confirm = async (options: ConfirmDialogOptions = {}) => {
    const instance = modal.open(options)
    return (await instance.result) as boolean
  }

  return { confirm }
}
