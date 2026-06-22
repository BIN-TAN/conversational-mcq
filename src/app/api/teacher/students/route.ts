import { NextResponse } from "next/server";
import {
  queryObjectFromUrl,
  requireStudentAccountTeacher,
  studentAccountRouteError
} from "@/lib/services/student-accounts/api";
import {
  createStudentAccount,
  listStudents,
  studentListQuerySchema
} from "@/lib/services/student-accounts/service";

export async function GET(request: Request) {
  const auth = await requireStudentAccountTeacher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const query = studentListQuerySchema.parse(queryObjectFromUrl(request.url));
    return NextResponse.json(await listStudents(query));
  } catch (error) {
    return studentAccountRouteError(error);
  }
}

export async function POST(request: Request) {
  const auth = await requireStudentAccountTeacher();

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const result = await createStudentAccount({
      teacher_user_db_id: auth.user.user_db_id,
      data: await request.json()
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return studentAccountRouteError(error);
  }
}
