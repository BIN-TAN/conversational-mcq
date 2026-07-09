import { stringify } from "csv-stringify/sync";

export type OneTimeCredential = {
  user_id: string;
  display_name: string | null;
  email?: string | null;
  temporary_access_code: string;
  temporary_password?: string;
};

function spreadsheetSafe(value: string) {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

export function credentialCsv(credentials: OneTimeCredential[]) {
  return stringify(
    credentials.map((credential) => ({
      user_id: spreadsheetSafe(credential.user_id),
      display_name: spreadsheetSafe(credential.display_name ?? ""),
      email: spreadsheetSafe(credential.email ?? ""),
      temporary_access_code: credential.temporary_access_code,
      temporary_password: credential.temporary_password ?? credential.temporary_access_code
    })),
    {
      bom: true,
      header: true,
      columns: ["user_id", "display_name", "email", "temporary_access_code", "temporary_password"]
    }
  );
}

export const oneTimeCredentialWarning =
  "Download or securely record these temporary passwords/access codes now. For security, they cannot be displayed again. If one is lost, generate a new temporary password.";
