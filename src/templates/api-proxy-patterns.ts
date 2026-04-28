/**
 * Python PII_PATTERNS literal block for the api-proxy sidecar.
 *
 * Extracted from api-proxy.ts to keep that file focused on the proxy logic.
 * This module is the single source of truth for the Python-side PII regex list.
 * The TS-side patterns live in src/sdk/patterns/.
 */

/**
 * Returns the Python `PII_PATTERNS = [...]` block (including the COMPILED_PII line)
 * as a string, ready to be interpolated into the api_proxy.py template.
 * Semantics are byte-identical to the original inline version.
 */
export function emitPythonPiiPatterns(): string {
  return `PII_PATTERNS = [
    # Korean
    (r"\\d{6}-[1-4]\\d{6}", "KR_RRN"),                         # 주민등록번호
    (r"01[016789]-\\d{3,4}-\\d{4}", "KR_PHONE"),                # 한국 휴대폰
    (r"0[2-6][0-9]-\\d{3,4}-\\d{4}", "KR_LANDLINE"),            # 한국 유선전화

    # Financial
    (r"\\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\\b", "CREDIT_CARD"),
    (r"\\b\\d{3,4}-\\d{4}-\\d{4}-\\d{4}\\b", "CARD_FORMATTED"),  # 카드번호 (포맷)

    # US
    (r"\\b\\d{3}-\\d{2}-\\d{4}\\b", "US_SSN"),
    (r"\\b\\d{3}[-.\\s]\\d{3}[-.\\s]\\d{4}\\b", "US_PHONE"),

    # Universal
    (r"\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}\\b", "EMAIL"),
]

COMPILED_PII = [(re.compile(p), label) for p, label in PII_PATTERNS]`;
}
