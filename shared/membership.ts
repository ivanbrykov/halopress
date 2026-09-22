export const MEMBERSHIP_MODES = ['disabled', 'open', 'invite', 'approval'] as const

export type MembershipMode = typeof MEMBERSHIP_MODES[number]

export type MembershipPublicSettings = {
  mode: MembershipMode
  registrationEnabled: boolean
  passwordRegistrationEnabled: boolean
  inviteRequired: boolean
  approvalRequired: boolean
  passwordRecoveryAvailable: false
  emailVerificationAvailable: false
}

export const DEFAULT_MEMBERSHIP_MODE: MembershipMode = 'disabled'
export const DEFAULT_MEMBER_ROLE = 'user'
