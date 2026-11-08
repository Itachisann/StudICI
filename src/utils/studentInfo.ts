import AsyncStorage from "@react-native-async-storage/async-storage";

export interface StudentInfo {
  matricola: string;
  email: string;
  updatedAt: number;
}

export const STUDENT_MATRICOLA_KEY = "studici_student_matricola";
export const STUDENT_EMAIL_KEY = "studici_student_email";
export const STUDENT_INFO_MODIFIED_KEY = "studici_student_info_modified_at";

const studentInfoListeners = new Set<() => void>();

export function subscribeToStudentInfoChanges(cb: () => void): () => void {
  studentInfoListeners.add(cb);
  return () => {
    studentInfoListeners.delete(cb);
  };
}

export function notifyStudentInfoChanged(): void {
  for (const listener of studentInfoListeners) {
    try {
      listener();
    } catch {}
  }
}

export async function getStudentInfo(): Promise<StudentInfo> {
  try {
    const [matricola, email, modStr] = await Promise.all([
      AsyncStorage.getItem(STUDENT_MATRICOLA_KEY),
      AsyncStorage.getItem(STUDENT_EMAIL_KEY),
      AsyncStorage.getItem(STUDENT_INFO_MODIFIED_KEY),
    ]);
    return {
      matricola: (matricola || "").trim(),
      email: (email || "").trim(),
      updatedAt: modStr ? parseInt(modStr, 10) : 0,
    };
  } catch {
    return { matricola: "", email: "", updatedAt: 0 };
  }
}

export async function saveStudentInfo(
  info: { matricola?: string; email?: string },
  customUpdatedAt?: number,
  silent: boolean = false
): Promise<StudentInfo> {
  const current = await getStudentInfo();
  const nextMatricola =
    info.matricola !== undefined ? info.matricola.trim() : current.matricola;
  const nextEmail =
    info.email !== undefined ? info.email.trim() : current.email;
  const updatedAt = customUpdatedAt || Date.now();

  await Promise.all([
    AsyncStorage.setItem(STUDENT_MATRICOLA_KEY, nextMatricola),
    AsyncStorage.setItem(STUDENT_EMAIL_KEY, nextEmail),
    AsyncStorage.setItem(STUDENT_INFO_MODIFIED_KEY, String(updatedAt)),
  ]);

  if (!silent) {
    notifyStudentInfoChanged();
  }

  return { matricola: nextMatricola, email: nextEmail, updatedAt };
}
