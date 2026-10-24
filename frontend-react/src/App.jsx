import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext.jsx'
import AppBoot from './components/AppBoot.jsx'
import LandingPage from './pages/LandingPage.jsx'
import SignInPage from './pages/SignInPage.jsx'
import SignUpPage from './pages/SignUpPage.jsx'
import WorkspacePage from './pages/WorkspacePage.jsx'
import SettingsPage from './pages/SettingsPage.jsx'
import WorkspaceShell from './components/WorkspaceShell.jsx'

function RequireAuth({ children }) {
  const { isAuthenticated, booting } = useAuth()
  const location = useLocation()

  if (booting) return <AppBoot />
  if (!isAuthenticated) {
    return <Navigate to="/signin" replace state={{ from: location.pathname }} />
  }
  return children
}

function RedirectIfSignedIn({ children }) {
  const { isAuthenticated, booting } = useAuth()
  if (booting) return <AppBoot />
  if (isAuthenticated) return <Navigate to="/app" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <RedirectIfSignedIn>
            <LandingPage />
          </RedirectIfSignedIn>
        }
      />
      <Route
        path="/signin"
        element={
          <RedirectIfSignedIn>
            <SignInPage />
          </RedirectIfSignedIn>
        }
      />
      <Route
        path="/signup"
        element={
          <RedirectIfSignedIn>
            <SignUpPage />
          </RedirectIfSignedIn>
        }
      />

      <Route
        element={
          <RequireAuth>
            <WorkspaceShell />
          </RequireAuth>
        }
      >
        <Route path="/app" element={<WorkspacePage />} />
        <Route path="/app/datasets/:datasetId" element={<WorkspacePage />} />
        <Route path="/app/sessions/:sessionId" element={<WorkspacePage />} />
        <Route path="/app/settings" element={<SettingsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
