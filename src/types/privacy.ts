/**
 * Privacy and KVKK/GDPR Type Definitions
 * Types for privacy management and compliance
 */

/**
 * Data processing activities (KVKK Article 4)
 */
export type DataProcessingActivity = 
  | 'registration'          // User registration
  | 'quiz_participation'    // Participating in quiz
  | 'audio_processing'      // Voice data processing
  | 'score_calculation'     // Score and ranking calculation
  | 'leaderboard_display'   // Public leaderboard display
  | 'data_export'          // Personal data export
  | 'analytics'            // Usage analytics
  | 'marketing'            // Marketing communications
  | 'support';             // Customer support

/**
 * Data categories (KVKK/GDPR)
 */
export type DataCategory = 
  | 'personal_data'      // Name, email, phone
  | 'audio_data'         // Voice recordings
  | 'performance_data'   // Quiz scores, answers
  | 'usage_data'         // App usage, timestamps
  | 'technical_data'     // IP, user agent
  | 'consent_data';      // Consent records

/**
 * Consent types
 */
export type ConsentType = 
  | 'terms_of_service'         // Terms acceptance
  | 'privacy_policy'           // Privacy policy acceptance
  | 'marketing_communications' // Marketing emails/SMS
  | 'audio_processing'         // Voice data processing
  | 'data_sharing'            // Sharing with third parties
  | 'analytics'               // Analytics and improvements
  | 'cookies';                // Cookie usage

/**
 * Legal basis for processing (KVKK Article 5)
 */
export enum LegalBasis {
  CONSENT = 'consent',                           // Explicit consent
  CONTRACT = 'contract',                         // Contract performance
  LEGAL_OBLIGATION = 'legal_obligation',         // Legal requirement
  VITAL_INTERESTS = 'vital_interests',           // Vital interests
  PUBLIC_TASK = 'public_task',                   // Public interest
  LEGITIMATE_INTERESTS = 'legitimate_interests', // Legitimate interests
}

/**
 * Data subject rights (KVKK Article 11)
 */
export enum DataSubjectRight {
  ACCESS = 'access',                   // Right to access
  RECTIFICATION = 'rectification',     // Right to rectification
  ERASURE = 'erasure',                // Right to erasure
  RESTRICTION = 'restriction',         // Right to restrict processing
  PORTABILITY = 'portability',         // Right to data portability
  OBJECTION = 'objection',            // Right to object
  WITHDRAW_CONSENT = 'withdraw',       // Right to withdraw consent
  COMPLAINT = 'complaint',             // Right to lodge complaint
}

/**
 * Privacy report structure
 */
export interface PrivacyReport {
  /** Participant ID */
  participantId: number;
  
  /** Report generation date */
  generatedAt: Date;
  
  /** Data categories being processed */
  dataCategories: DataCategory[];
  
  /** Processing activities */
  processingActivities: DataProcessingActivityRecord[];
  
  /** Retention periods by category */
  retentionPeriods: Record<DataCategory, number>;
  
  /** Legal basis for processing */
  legalBasis: LegalBasisRecord[];
  
  /** Consent status */
  consentStatus: ConsentStatus[];
  
  /** Data sharing details */
  dataSharingDetails?: DataSharingRecord[];
  
  /** Rights exercised */
  rightsExercised: RightsExerciseRecord[];
}

/**
 * Data processing activity record
 */
export interface DataProcessingActivityRecord {
  /** Activity type */
  activity: DataProcessingActivity;
  
  /** Processing purpose */
  purpose: string;
  
  /** Data categories involved */
  dataCategories: DataCategory[];
  
  /** Legal basis */
  legalBasis: LegalBasis;
  
  /** Retention period in days */
  retentionDays: number;
  
  /** Is automated processing */
  isAutomated: boolean;
  
  /** First processed date */
  firstProcessed: Date;
  
  /** Last processed date */
  lastProcessed: Date;
}

/**
 * Legal basis record
 */
export interface LegalBasisRecord {
  /** Data category */
  dataCategory: DataCategory;
  
  /** Legal basis */
  basis: LegalBasis;
  
  /** Detailed explanation */
  explanation: string;
  
  /** Related consent (if basis is consent) */
  relatedConsent?: ConsentType;
}

/**
 * Consent status
 */
export interface ConsentStatus {
  /** Consent type */
  consentType: ConsentType;
  
  /** Current status */
  status: 'given' | 'withdrawn' | 'not_given';
  
  /** Consent version */
  version: string;
  
  /** Date given */
  givenAt?: Date;
  
  /** Date withdrawn */
  withdrawnAt?: Date;
  
  /** Collection method */
  collectionMethod: 'web_form' | 'api' | 'import' | 'verbal';
  
  /** IP address when given */
  ipAddress?: string;
}

/**
 * Data sharing record
 */
export interface DataSharingRecord {
  /** Recipient name */
  recipient: string;
  
  /** Recipient type */
  recipientType: 'processor' | 'controller' | 'third_party';
  
  /** Purpose of sharing */
  purpose: string;
  
  /** Data categories shared */
  dataCategories: DataCategory[];
  
  /** Legal basis for sharing */
  legalBasis: LegalBasis;
  
  /** Country if international transfer */
  country?: string;
  
  /** Safeguards for international transfer */
  transferSafeguards?: string;
}

/**
 * Rights exercise record
 */
export interface RightsExerciseRecord {
  /** Right exercised */
  right: DataSubjectRight;
  
  /** Request date */
  requestDate: Date;
  
  /** Response date */
  responseDate?: Date;
  
  /** Request status */
  status: 'pending' | 'in_progress' | 'completed' | 'rejected';
  
  /** Outcome */
  outcome?: string;
  
  /** Rejection reason */
  rejectionReason?: string;
}

/**
 * Data deletion request
 */
export interface DataDeletionRequest {
  /** Participant ID */
  participantId: number;
  
  /** Deletion scope */
  scope: 'all' | 'personal' | 'activity' | 'specific';
  
  /** Specific data categories (if scope is specific) */
  categories?: DataCategory[];
  
  /** Reason for deletion */
  reason: string;
  
  /** Requester type */
  requesterType: 'data_subject' | 'legal_representative' | 'authority';
  
  /** Verification method used */
  verificationMethod: string;
}

/**
 * Data deletion result
 */
export interface DataDeletionResult {
  /** Request ID */
  requestId: string;
  
  /** Deletion status */
  status: 'completed' | 'partial' | 'failed';
  
  /** Deleted data summary */
  deletedData: {
    category: DataCategory;
    recordCount: number;
    status: 'deleted' | 'anonymized' | 'retained';
    retentionReason?: string;
  }[];
  
  /** Deletion timestamp */
  deletedAt: Date;
  
  /** Deletion certificate */
  certificate?: string;
  
  /** Error details (if failed) */
  errors?: string[];
}

/**
 * Data export request
 */
export interface DataExportRequest {
  /** Participant ID */
  participantId: number;
  
  /** Export format */
  format: 'json' | 'csv' | 'pdf' | 'xml';
  
  /** Data categories to export */
  categories?: DataCategory[];
  
  /** Include processing history */
  includeHistory: boolean;
  
  /** Language preference */
  language: 'tr' | 'en';
}

/**
 * Data export result
 */
export interface DataExportResult {
  /** Export ID */
  exportId: string;
  
  /** Export status */
  status: 'ready' | 'processing' | 'failed';
  
  /** Download URL (if ready) */
  downloadUrl?: string;
  
  /** URL expiry time */
  expiresAt?: Date;
  
  /** File size in bytes */
  fileSize?: number;
  
  /** Export summary */
  summary: {
    totalRecords: number;
    categories: DataCategory[];
    dateRange: {
      from: Date;
      to: Date;
    };
  };
}

/**
 * Privacy settings
 */
export interface PrivacySettings {
  /** Participant ID */
  participantId: number;
  
  /** Marketing preferences */
  marketing: {
    email: boolean;
    sms: boolean;
    push: boolean;
  };
  
  /** Analytics preferences */
  analytics: {
    usageTracking: boolean;
    performanceTracking: boolean;
    errorReporting: boolean;
  };
  
  /** Data sharing preferences */
  dataSharing: {
    shareForImprovements: boolean;
    shareWithPartners: boolean;
    publicLeaderboard: boolean;
  };
  
  /** Communication preferences */
  communication: {
    language: 'tr' | 'en';
    frequency: 'immediate' | 'daily' | 'weekly' | 'never';
  };
}

/**
 * Anonymization level
 */
export enum AnonymizationLevel {
  BASIC = 'basic',         // Remove direct identifiers
  MEDIUM = 'medium',       // Remove quasi-identifiers
  STRONG = 'strong',       // Statistical noise addition
  IRREVERSIBLE = 'irreversible', // Complete anonymization
}

/**
 * Privacy audit entry
 */
export interface PrivacyAuditEntry {
  /** Entry ID */
  id: string;
  
  /** Activity type */
  activity: DataProcessingActivity;
  
  /** Data subjects affected */
  affectedSubjects: number;
  
  /** Data categories */
  dataCategories: DataCategory[];
  
  /** Purpose */
  purpose: string;
  
  /** Legal basis */
  legalBasis: LegalBasis;
  
  /** Risk level */
  riskLevel: 'low' | 'medium' | 'high';
  
  /** Safeguards applied */
  safeguards: string[];
  
  /** Audit date */
  auditDate: Date;
  
  /** Auditor */
  auditor: string;
  
  /** Findings */
  findings?: string;
  
  /** Recommendations */
  recommendations?: string[];
}

/**
 * Cookie information
 */
export interface CookieInfo {
  /** Cookie name */
  name: string;
  
  /** Cookie purpose */
  purpose: string;
  
  /** Cookie type */
  type: 'necessary' | 'functional' | 'analytics' | 'marketing';
  
  /** Duration */
  duration: string;
  
  /** Provider */
  provider: string;
  
  /** Description */
  description: string;
}

/**
 * Data breach notification
 */
export interface DataBreachNotification {
  /** Breach ID */
  breachId: string;
  
  /** Discovery date */
  discoveredAt: Date;
  
  /** Breach date (if known) */
  breachDate?: Date;
  
  /** Breach type */
  type: 'confidentiality' | 'integrity' | 'availability';
  
  /** Data categories affected */
  categoriesAffected: DataCategory[];
  
  /** Number of subjects affected */
  subjectsAffected: number;
  
  /** Risk assessment */
  riskLevel: 'low' | 'medium' | 'high' | 'severe';
  
  /** Measures taken */
  measuresTaken: string[];
  
  /** Authority notified */
  authorityNotified: boolean;
  
  /** Authority notification date */
  authorityNotificationDate?: Date;
  
  /** Subjects notified */
  subjectsNotified: boolean;
  
  /** Subject notification date */
  subjectNotificationDate?: Date;
}
