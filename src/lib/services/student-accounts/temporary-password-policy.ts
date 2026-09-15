import { parseStudentTemporaryPassword } from "./validation";

// This course bootstrap password is temporary, never a student's private password.
export function getDefaultStudentTemporaryPassword() {
  return parseStudentTemporaryPassword(process.env.STUDENT_DEFAULT_TEMPORARY_PASSWORD ?? "edpy507");
}
