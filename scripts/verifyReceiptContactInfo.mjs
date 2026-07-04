const OFFICIAL_PHONE = "090-6331-4289";
const LEGACY_WRONG_PHONES = new Set(["090-3238-8171", "09032388171"]);

function normalizePhoneDigits(phoneNumber){
  return phoneNumber.replace(/\D/g, "");
}

function resolveReceiptPhoneNumber(phoneNumber){
  const trimmed = String(phoneNumber || "").trim();
  if(!trimmed){
    return OFFICIAL_PHONE;
  }
  const digits = normalizePhoneDigits(trimmed);
  if(LEGACY_WRONG_PHONES.has(trimmed) || LEGACY_WRONG_PHONES.has(digits)){
    return OFFICIAL_PHONE;
  }
  return trimmed;
}

function resolveReceiptCompanySettings(company){
  return {
    ...company,
    phoneNumber: resolveReceiptPhoneNumber(company.phoneNumber),
  };
}

const unitChecks = [
  [resolveReceiptPhoneNumber("090-3238-8171"), OFFICIAL_PHONE, "legacy wrong phone"],
  [resolveReceiptPhoneNumber(""), OFFICIAL_PHONE, "empty phone"],
  [resolveReceiptPhoneNumber("090-6331-4289"), OFFICIAL_PHONE, "official phone kept"],
  [resolveReceiptCompanySettings({ phoneNumber: "090-3238-8171" }).phoneNumber, OFFICIAL_PHONE, "company settings phone"],
];

const unitFailures = unitChecks.filter(function([actual, expected]){ return actual !== expected; });
if(unitFailures.length){
  console.error("Unit failures:");
  unitFailures.forEach(function([actual, expected, label]){
    console.error(" - " + label + ": expected " + expected + ", got " + actual);
  });
  process.exitCode = 1;
}else{
  console.log("Unit checks: PASS (" + unitChecks.length + ")");
}
