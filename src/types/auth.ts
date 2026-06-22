export type AppRole = "student" | "teacher_researcher";

export type PublicUser = {
  user_db_id: string;
  user_id: string;
  role: AppRole;
};

export type ClientUser = {
  user_id: string;
  role: AppRole;
};
