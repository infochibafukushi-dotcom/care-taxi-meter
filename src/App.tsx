import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './App.css'
import { AppLayout } from './layouts/AppLayout'
import { AdminPage } from './pages/AdminPage'
import { CaseDetailPage } from './pages/CaseDetailPage'
import { CaseListPage } from './pages/CaseListPage'
import { CasePage } from './pages/CasePage'
import { CaseStartPage } from './pages/CaseStartPage'
import { HeadquartersPage } from './pages/HeadquartersPage'
import { HomePage } from './pages/HomePage'
import { ObdPocPage } from './pages/ObdPocPage'
import { PrinterPocPage } from './pages/PrinterPocPage'
import { ReservationDetailPage } from './pages/ReservationDetailPage'
import { ReservationListPage } from './pages/ReservationListPage'
import { SalesAnalyticsPage } from './pages/SalesAnalyticsPage'
import { ReviewDemoCasePage } from './pages/ReviewDemoCasePage'
import { ReviewDemoCaseStartPage } from './pages/ReviewDemoCaseStartPage'
import { ReviewDemoReservationDetailPage } from './pages/ReviewDemoReservationDetailPage'
import { ReviewDemoReservationListPage } from './pages/ReviewDemoReservationListPage'

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
        path: 'case/start',
        element: <CaseStartPage />,
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
        path: 'reservations',
        element: <ReservationListPage />,
      },
      {
        path: 'reservations/:reservationId',
        element: <ReservationDetailPage />,
      },
      {
        path: 'driver',
        element: <HomePage />,
      },
      {
        path: 'manager',
        element: <AdminPage />,
      },
      {
        path: 'owner',
        element: <AdminPage />,
      },
      {
        path: 'hq',
        element: <HeadquartersPage />,
      },
      {
        path: 'admin',
        element: <AdminPage />,
      },
      {
        path: 'admin/analytics',
        element: <SalesAnalyticsPage />,
      },
      {
        path: 'superadmin',
        element: <HeadquartersPage />,
      },
      {
        path: 'dev/obd',
        element: <ObdPocPage />,
      },
      {
        path: 'dev/printer',
        element: <PrinterPocPage />,
      },
      {
        path: 'review-demo/reservations',
        element: <ReviewDemoReservationListPage />,
      },
      {
        path: 'review-demo/reservations/:reservationId',
        element: <ReviewDemoReservationDetailPage />,
      },
      {
        path: 'review-demo/case/start',
        element: <ReviewDemoCaseStartPage />,
      },
      {
        path: 'review-demo/case',
        element: <ReviewDemoCasePage />,
      },
    ],
  },
], { basename: routerBaseName })

function App() {
  console.info('[App] RouterProvider render')

  return <RouterProvider router={router} />
}

export default App
