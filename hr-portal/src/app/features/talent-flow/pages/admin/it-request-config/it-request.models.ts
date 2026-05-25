/** Shared models for the IT Request Config pages */

export type QueueCategory = 'HARDWARE' | 'SOFTWARE' | 'ACCESS' | 'INFRA';

export interface ITQueue {
  id:                   string;
  name:                 string;
  description:          string;
  category:             QueueCategory;
  slaHours:             number;
  assignedSpecialists:  string[];
  active:               boolean;
}

export type RequirementCategory = 'HARDWARE' | 'SOFTWARE' | 'ACCESS' | 'PERIPHERALS' | 'OTHER';

export interface TemplateRequirement {
  itemName:  string;
  category:  RequirementCategory;
  optional:  boolean;
}

export interface ProvisioningTemplate {
  id:           string;
  name:         string;
  description:  string;
  targetRole:   string;
  requirements: TemplateRequirement[];
  active:       boolean;
}

export type ConditionField = 'department' | 'role' | 'location' | 'seniority';

export interface RoutingRule {
  id:             string;
  conditionField: ConditionField;
  conditionValue: string;
  targetQueueId:  string;
  priority:       number;
}
