import { defaultMeterSettings, type MeterSettings } from './meterSettings'
import {
  REVIEW_DEMO_COMPANY_NAME,
  REVIEW_DEMO_STORE_NAME,
} from '../utils/reviewDemo'

export const reviewDemoMeterSettings: MeterSettings = {
  ...defaultMeterSettings,
  company: {
    ...defaultMeterSettings.company,
    companyName: REVIEW_DEMO_COMPANY_NAME,
    corporateName: REVIEW_DEMO_COMPANY_NAME,
    tradeName: REVIEW_DEMO_STORE_NAME,
  },
  receipt: {
    ...defaultMeterSettings.receipt,
    issuerName: REVIEW_DEMO_COMPANY_NAME,
    defaultReceiptNote: '介護タクシー利用料として（審査用デモ）',
  },
}

export const getReviewDemoMeterSettings = () => reviewDemoMeterSettings
