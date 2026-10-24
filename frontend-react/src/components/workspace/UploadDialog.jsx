import { useRef, useState } from 'react'
import { FileSpreadsheet, UploadCloud } from 'lucide-react'
import Modal from '../ui/Modal.jsx'
import Button from '../ui/Button.jsx'
import { useToast } from '../../contexts/ToastContext.jsx'
import { useWorkspace } from '../../contexts/WorkspaceContext.jsx'
import { uploadDataset } from '../../api/datasets'
import { useNavigate } from 'react-router-dom'

const MAX_BYTES = 25 * 1024 * 1024

/** Upload as a deliberate step: pick, confirm, then it appears in the workspace. */
export default function UploadDialog({ open, onClose }) {
  const toast = useToast()
  const navigate = useNavigate()
  const { refresh } = useWorkspace()
  const inputRef = useRef(null)

  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const [dragging, setDragging] = useState(false)

  const reset = () => {
    setFile(null)
    setError(null)
    setUploading(false)
  }

  const choose = (candidate) => {
    setError(null)
    if (!candidate) return

    const name = candidate.name.toLowerCase()
    if (!name.endsWith('.csv') && !name.endsWith('.xlsx')) {
      setError('Choose a .csv or .xlsx file.')
      return
    }
    if (candidate.size > MAX_BYTES) {
      setError('That file is larger than 25 MB.')
      return
    }
    if (candidate.size === 0) {
      setError('That file is empty.')
      return
    }
    setFile(candidate)
  }

  const upload = async () => {
    if (!file || uploading) return
    setUploading(true)
    setError(null)
    try {
      const dataset = await uploadDataset(file)
      toast.success('Dataset added', `${dataset.name} is ready to query.`)
      refresh()
      onClose()
      reset()
      navigate(`/app/datasets/${dataset.id}`)
    } catch (err) {
      setError(err.message)
      setUploading(false)
    }
  }

  const close = () => {
    if (uploading) return
    reset()
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add a dataset"
      description="CSV or Excel, up to 25 MB. The file is written to this machine's disk and read here."
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={uploading}>
            Cancel
          </Button>
          <Button onClick={upload} loading={uploading} disabled={!file}>
            Add dataset
          </Button>
        </>
      }
    >
      <div
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          choose(event.dataTransfer.files?.[0])
        }}
        className={[
          'rounded-md border border-dashed px-4 py-7 text-center transition-colors',
          dragging ? 'border-seal bg-seal-wash' : 'border-hairline bg-paper',
        ].join(' ')}
      >
        {file ? (
          <div className="flex items-center justify-center gap-2.5">
            <FileSpreadsheet className="h-4 w-4 text-seal" />
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium text-ink">{file.name}</span>
              <span className="block font-mono text-[10.5px] text-ink-muted">
                {(file.size / 1024).toFixed(0)} KB
              </span>
            </span>
            <Button variant="quiet" size="sm" onClick={() => inputRef.current?.click()}>
              Change
            </Button>
          </div>
        ) : (
          <>
            <UploadCloud className="mx-auto h-5 w-5 text-ink-muted" />
            <p className="mt-2 text-[13px] text-ink-soft">
              Drop a file here, or{' '}
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="font-medium text-seal underline-offset-2 hover:underline"
              >
                choose one
              </button>
            </p>
            <p className="mt-1 font-mono text-[10.5px] text-ink-muted">CSV · XLSX</p>
          </>
        )}

        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx"
          className="hidden"
          onChange={(event) => {
            choose(event.target.files?.[0])
            event.target.value = ''
          }}
        />
      </div>

      {error ? (
        <p className="mt-2.5 rounded border border-alarm/25 bg-alarm-wash px-3 py-2 text-[12.5px] text-alarm">
          {error}
        </p>
      ) : null}
    </Modal>
  )
}
