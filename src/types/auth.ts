export type AppRole = "student" | "teacher_researcher";

export type PublicUser = {
  user_db_id: string;
  user_id: string;
  role: AppRole;
  auth_version: number;
  must_change_password?: boolean;
};

export type ClientUser = {
  user_id: string;
  role: AppRole;
  must_change_password?: boolean;
};
