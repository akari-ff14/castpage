import { useEffect } from 'react'

interface Props {
  children: React.ReactNode
  onClose: () => void
  closeOnBackdrop?: boolean
}

export default function Modal({ children, onClose, closeOnBackdrop = true }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-overlay" onClick={closeOnBackdrop ? onClose : undefined}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}
