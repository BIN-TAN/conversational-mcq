import { stringify } from "csv-stringify/sync";

export type OneTimeCredential = {
  user_id: string;
  display_name: string | null;
  temporary_access_code: string;
};

function spreadsheetSafe(value: string) {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

export function credentialCsv(credentials: OneTimeCredential[]) {
  return stringify(
    credentials.map((credential) => ({
      user_id: spreadsheetSafe(credential.user_id),
      display_name: spreadsheetSafe(credential.display_name ?? ""),
      temporary_access_code: credential.temporary_access_code
    })),
    {
      bom: true,
      header: true,
      columns: ["user_id", "display_name", "temporary_access_code"]
    }
  );
}

export const oneTimeCredentialWarning =
  "Download or securely record these access codes now. For security, they cannot be displayed again. If a code is lost, generate a new one.";
