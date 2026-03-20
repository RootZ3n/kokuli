// Learning module types — zero dependency on engine/

export type SecurityConcept =
  | "prompt_injection"
  | "social_engineering"
  | "ddos"
  | "exfiltration"
  | "firewalls"
  | "input_validation"
  | "authentication"
  | "encryption"
  | "network_security"
  | "ai_security";

export type Creature = {
  name: string;
  concept: SecurityConcept;
  description: string;
  zone: string;
  difficulty: number; // 1-10
  encounter: string; // narrative encounter text
  hint: string;
  quiz: QuizQuestion;
};

export type QuizQuestion = {
  question: string;
  choices: string[];
  correctIndex: number;
  explanation: string;
};

export type Zone = {
  id: string;
  name: string;
  description: string;
  requiredLevel: number;
  creatures: string[]; // creature names
  narrative: string;
};

export type PlayerState = {
  name: string;
  level: number;
  xp: number;
  completedZones: string[];
  defeatedCreatures: string[];
  currentZone: string | null;
};

export type CurriculumModule = {
  id: string;
  title: string;
  concept: SecurityConcept;
  order: number;
  objectives: string[];
  content: string;
  quiz: QuizQuestion[];
};

// XP thresholds per level
export const XP_PER_LEVEL = 100;

export function levelFromXp(xp: number): number {
  return Math.floor(xp / XP_PER_LEVEL) + 1;
}
