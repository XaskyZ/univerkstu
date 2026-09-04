export interface ProfileDetailEntry {
    label: string;
    value: string;
}

export interface ProfileSection {
    key: string;
    title: string;
    entries: ProfileDetailEntry[];
}

export interface ProfileOrderRecord {
    course: string | null;
    numberAndDate: string;
    description: string | null;
}

export interface StudentQuestionnaireSummary {
    paymentForm: string | null;
    foreignLanguage: string | null;
    admissionType: string | null;
    grantIssueDate: string | null;
    grantNumber: string | null;
    specialization: string | null;
    studentStatus: string | null;
    studyState: string | null;
    iktCode: string | null;
    admissionBasis: string | null;
    workPosition: string | null;
    healthStatus: string | null;
    studentId: string | null;
    firstName: string | null;
    lastName: string | null;
    middleName: string | null;
    recordBookNumber: string | null;
    gender: string | null;
    country: string | null;
    localityStatus: string | null;
    residenceRegion: string | null;
    district: string | null;
    birthPlace: string | null;
    studentResidence: string | null;
    needsDormitory: string | null;
    arrivalAddress: string | null;
    mobilePhone: string | null;
    parentsContacts: string | null;
    birthDate: string | null;
    citizenship: string | null;
    nationality: string | null;
    familyStatus: string | null;
    financialCategory: string | null;
    workplace: string | null;
}

export interface StudentQuestionnaire {
    sections: ProfileSection[];
    orders: ProfileOrderRecord[];
    summary: StudentQuestionnaireSummary;
}

export interface TranscriptSubjectRecord {
    termLabel: string;
    code: string;
    subject: string;
    credits: number;
    hours: number;
    numericGrade: number | null;
    letterGrade: string | null;
    gpa: number | null;
}

export interface TranscriptYearSummary {
    label: string;
    creditsEarned: number | null;
    gpa: number | null;
}

export interface TranscriptPracticeRecord {
    practiceType: string;
    period: string;
    credits: number;
    hours: number;
    numericGrade: number | null;
    letterGrade: string | null;
    gpa: number | null;
}

export interface TranscriptFinalAttestationRecord {
    subject: string;
    protocolDate: string | null;
    credits: number;
    hours: number;
    grade: string | null;
}

export interface TranscriptSummary {
    fullName: string | null;
    faculty: string | null;
    educationStep: string | null;
    groupProgram: string | null;
    educationalProgram: string | null;
    formOfEducation: string | null;
    course: number | null;
    educationLevel: string | null;
    department: string | null;
    studyDuration: string | null;
    caseFileNumber: string | null;
}

export interface TranscriptStats {
    totalSubjects: number | null;
    excellent: number | null;
    good: number | null;
    satisfactory: number | null;
    unsatisfactory: number | null;
}

export interface StudentTranscript {
    summary: TranscriptSummary;
    subjects: TranscriptSubjectRecord[];
    yearSummaries: TranscriptYearSummary[];
    practices: TranscriptPracticeRecord[];
    finalAttestations: TranscriptFinalAttestationRecord[];
    stats: TranscriptStats;
    orders: ProfileOrderRecord[];
}

export interface RecbookSummary {
    fullName: string | null;
    faculty: string | null;
    educationStep: string | null;
    specialtyCode: string | null;
    specialty: string | null;
    formOfEducation: string | null;
    educationLevel: string | null;
    specialization: string | null;
    course: number | null;
    department: string | null;
    studyDuration: string | null;
    caseFileNumber: string | null;
}

export interface RecbookRecord {
    termLabel: string;
    subject: string;
    credits: number;
    rk: number | null;
    mt: number | null;
    teacher: string | null;
    pa: number | null;
    examDate: string | null;
    examiner: string | null;
    numericGrade: number | null;
    letterGrade: string | null;
}

export interface StudentRecbook {
    summary: RecbookSummary;
    records: RecbookRecord[];
}

export interface StudentPracticeGroup {
    groupNumber: string;
    practiceType: string;
    period: string;
    supervisor: string | null;
    organization: string | null;
    status: string | null;
}

export interface StudentPractice {
    groups: StudentPracticeGroup[];
}

export interface StudentAdvisor {
    fullName: string | null;
    email: string | null;
    workPhone: string | null;
}

export interface StudentEducPlanSummary {
    formOfEducation: string | null;
    educationStep: string | null;
    educationLevel: string | null;
    specialty: string | null;
    totalSemesters: number | null;
    admissionYear: number | null;
}

export interface StudentEducPlanCycleCounts {
    ood: number | null;
    bd: number | null;
    pd: number | null;
    additionalDisciplines: number | null;
    additionalLearning: number | null;
}

export interface StudentEducPlanSemesterOverview {
    semesterNumber: number | null;
    totalSubjects: number;
    totalCredits: number;
    controlTypes: string[];
}

export interface StudentEducPlan {
    summary: StudentEducPlanSummary;
    cycleCounts: StudentEducPlanCycleCounts;
    semesters: StudentEducPlanSemesterOverview[];
}

export interface StudentAcademicOptions {
    retake: {
        availableCount: number;
        submittedCount: number;
    };
    fx: {
        availableCount: number;
        submittedCount: number;
    };
    gpaIncrease: {
        availableCount: number;
        submittedCount: number;
        annualCost: string | null;
        currentGpa: number | null;
        earnedCredits: number | null;
    };
}

export interface StudentProfile {
    fullName: string;
    formOfEducation: string;
    educationLevel: string;
    department: string;
    educationStep: string;
    faculty: string;
    specialty: string;
    groupName?: string;
    course: number;
    transferGPA: number;
    questionnaire?: StudentQuestionnaire;
}

export interface AttestationGrade {
    subject: string;
    credits: number;
    rk1?: number;
    rk2?: number;
    pa?: number;
    total: number;
    gpa: number;
    letterGrade: string;
    description: string;
}

export interface Attestation {
    currentGPA: number;
    currentYear: string;
    creditsEarned: number;
    grades: AttestationGrade[];
}

export interface ProfileData {
    profile: StudentProfile;
    attestation: Attestation;
    iup?: unknown;
    transcript?: StudentTranscript | null;
    recbook?: StudentRecbook | null;
    practice?: StudentPractice | null;
    advisor?: StudentAdvisor | null;
    educPlan?: StudentEducPlan | null;
    academicOptions?: StudentAcademicOptions | null;
    meta?: {
        parsedAt: string;
        userId: string;
    };
}
