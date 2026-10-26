export const CITIZEN_CONSENT_VERSION = 'citizen-email-v1';
export const CITIZEN_COVERAGE = 'carolina-beach-gauge';
export const SUBSCRIPTIONS = 'citizen_alert_subscriptions';
export const OUTBOX = 'citizen_alert_outbox';

export type SubscriptionStatus = 'early-access' | 'verification-required' | 'active' | 'paused' | 'unsubscribed';
export interface CitizenAccount { uid: string; email: string | null; emailVerified: boolean; disabled: boolean }
export interface CitizenSubscription {
  version: 1;
  uid: string;
  email: string;
  status: SubscriptionStatus;
  locationId: 'carolina-beach';
  coverage: typeof CITIZEN_COVERAGE;
  channel: 'email';
  consentVersion: string;
  consentAt: string;
  createdAt: string;
  updatedAt: string;
  /** Incrementing this revokes already queued deliveries after pause/unsubscribe. */
  generation: number;
  /** Retried until this enrollment sees one usable forecast, including dry. */
  catchupPending?: boolean;
  unsubscribeHash: string;
  lastTestAt: string | null;
}
export interface DeliveryConfiguration {
  enabled: boolean;
  provider: 'resend' | 'disabled';
  fromEmail: string | null;
  publicBaseUrl: string | null;
  apiKey: string | null;
}
export type CitizenAction = 'enroll' | 'resume' | 'pause' | 'unsubscribe' | 'test';
export interface CitizenActionRequest { action: CitizenAction; consentVersion?: string }
export interface CitizenHistory {
  id: string;
  kind: 'enrollment' | 'pause' | 'unsubscribe' | 'test' | 'flood';
  state: string;
  createdAt: string;
  updatedAt: string;
  subject: string;
}
export interface CitizenStatusResponse {
  version: 1;
  locationId: 'carolina-beach';
  deliveryReady: boolean;
  readinessReason: 'email-pilot-enabled' | 'email-delivery-not-enabled';
  billingEnabled: false;
  consentVersion: typeof CITIZEN_CONSENT_VERSION;
  email: string | null;
  emailVerified: boolean;
  subscription: null | {
    status: SubscriptionStatus;
    email: string | null;
    emailVerified: boolean;
    coverage: typeof CITIZEN_COVERAGE;
    channel: 'email';
    consentVersion: string;
    createdAt: string;
    updatedAt: string;
  };
  history: CitizenHistory[];
}
export interface CitizenDelivery {
  version: 1;
  uid: string;
  subscriptionGeneration: number;
  email: string;
  kind: 'test' | 'flood';
  state: 'queued' | 'leased' | 'retry' | 'sent' | 'expired' | 'cancelled' | 'failed';
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  nextAttemptAt: string;
  attempts: number;
  leaseId: string | null;
  leaseUntil: string | null;
  providerMessageId: string | null;
  subject: string;
  text: string;
  unsubscribeToken: string;
  sourceIntentId: string | null;
  sourceEpisodeId: string | null;
  sourceRevisionId: string | null;
}
