import Button from '../ui/Button'
import Input from '../ui/Input'

interface MessageComposerProps {
  recipientName: string
  value: string
  onChange: (value: string) => void
  onSubmit: (e: React.FormEvent) => void
}

export default function MessageComposer({ recipientName, value, onChange, onSubmit }: MessageComposerProps) {
  return (
    <div className="border-t border-slate-700 p-4">
      <form onSubmit={onSubmit} className="flex gap-2">
        <Input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={`Message ${recipientName}...`}
          aria-label={`Message ${recipientName}`}
          className="flex-1"
        />
        <Button
          type="submit"
          disabled={!value.trim()}
          aria-label="Send message"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        </Button>
      </form>
    </div>
  )
}
