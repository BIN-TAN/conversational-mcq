import { AssessmentCreateClient } from "@/components/teacher-content/assessment-form-client";
import { getCourseTimezone } from "@/lib/services/assessment-availability/timezone";

export default function NewAssessmentPage() {
  return <AssessmentCreateClient courseTimezone={getCourseTimezone()} />;
}
