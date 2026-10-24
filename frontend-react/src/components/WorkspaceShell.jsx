import { useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { PanelLeft } from 'lucide-react'
import Sidebar from './workspace/Sidebar.jsx'
import UploadDialog from './workspace/UploadDialog.jsx'
import Button from './ui/Button.jsx'
import { Wordmark } from './ui/Seal.jsx'
import { WorkspaceProvider } from '../contexts/WorkspaceContext.jsx'

export default function WorkspaceShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()

  // `/app?upload=1` opens the dialog. The flag is read during render so the first
  // paint already has it open, and the effect only cleans the URL afterwards.
  const uploadRequested = new URLSearchParams(location.search).get('upload') === '1'
  const [uploadOpen, setUploadOpen] = useState(uploadRequested)
  const [openedFromUrl, setOpenedFromUrl] = useState(uploadRequested)

  if (uploadRequested && !openedFromUrl) {
    setOpenedFromUrl(true)
    setUploadOpen(true)
  }

  useEffect(() => {
    if (!uploadRequested) return
    const params = new URLSearchParams(location.search)
    params.delete('upload')
    const query = params.toString()
    navigate({ pathname: location.pathname, search: query ? `?${query}` : '' }, { replace: true })
  }, [uploadRequested, location.pathname, location.search, navigate])

  return (
    <WorkspaceProvider>
      <div className="flex h-full w-full overflow-hidden bg-paper">
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} onUpload={() => setUploadOpen(true)} />

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Mobile chrome. Desktop keeps the rail permanently visible. */}
          <header className="flex items-center gap-3 border-b border-hairline bg-paper-raised px-3 py-2.5 lg:hidden">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open navigation"
            >
              <PanelLeft className="h-4 w-4" />
            </Button>
            <Wordmark />
          </header>

          <main className="flex min-h-0 flex-1 flex-col">
            <Outlet />
          </main>
        </div>

        <UploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} />
      </div>
    </WorkspaceProvider>
  )
}
