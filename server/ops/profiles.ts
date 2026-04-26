import type { ArmoryExecutionTier, ArmoryProfileId } from "./armory";

export type ArmoryProfileDefinition = {
  id: ArmoryProfileId;
  label: string;
  requiredTier: ArmoryExecutionTier;
  intro: string;
  supportsHttpFollowUp: boolean;
};

export const ARMORY_PROFILES: Record<ArmoryProfileId, ArmoryProfileDefinition> = {
  quick_scan: {
    id: "quick_scan",
    label: "Quick Scan",
    requiredTier: 1,
    intro: "This profile checks the target for commonly exposed services using a safe top-100-port scan.",
    supportsHttpFollowUp: false,
  },
  break_me: {
    id: "break_me",
    label: "Break Me (Beginner Mode)",
    requiredTier: 1,
    intro: "This profile teaches the user what is being tested, looks for reachable HTTP surfaces, and tries a harmless prompt-injection string only when an HTTP endpoint is discovered.",
    supportsHttpFollowUp: true,
  },
};

export function getProfileDefinition(profileId: ArmoryProfileId): ArmoryProfileDefinition {
  const profile = ARMORY_PROFILES[profileId];
  if (!profile) throw new Error(`Unknown Armory profile: ${profileId}`);
  return profile;
}
