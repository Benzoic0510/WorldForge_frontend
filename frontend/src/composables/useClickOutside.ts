import { onMounted, onUnmounted, type Ref } from 'vue'

export function useClickOutside(target: Ref<HTMLElement | null>, callback: () => void) {
  function handlePointerDown(event: PointerEvent) {
    if (!target.value) return
    if (!(event.target instanceof Node)) return
    if (target.value.contains(event.target)) return
    callback()
  }

  onMounted(() => {
    document.addEventListener('pointerdown', handlePointerDown)
  })

  onUnmounted(() => {
    document.removeEventListener('pointerdown', handlePointerDown)
  })
}
