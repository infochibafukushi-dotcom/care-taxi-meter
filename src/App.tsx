import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './App.css'
import { AppLayout } from './layouts/AppLayout'
import { AdminPage } from './pages/AdminPage'
import { CaseDetailPage } from './pages/CaseDetailPage'
import { CaseListPage } from './pages/CaseListPage'
import { CasePage } from './pages/CasePage'
import { HomePage } from './pages/HomePage'

const routerBaseName =
  import.meta.env.BASE_URL === '/'
    ? undefined
    : import.meta.env.BASE_URL.replace(/\/$/, '')

const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      {
        index: true,
        element: <HomePage />,
      },
      {
        path: 'case',
        element: <CasePage />,
      },
      {
        path: 'cases',
        element: <CaseListPage />,
      },
      {
        path: 'cases/:caseRecordId',
        element: <CaseDetailPage />,
      },
      {
        path: 'admin',
        element: <AdminPage />,
      },
    ],
  },
], { basename: routerBaseName })

function App() {
  return <RouterProvider router={router} />
}

export default App
