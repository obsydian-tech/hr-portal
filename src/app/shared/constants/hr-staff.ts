export type HrStaffRole = 'HR_PARTNER' | 'HR_MANAGER';

export interface HrStaffMember {
  staffId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  role: HrStaffRole;
}

export const HR_STAFF_REGISTRY: HrStaffMember[] = [
  {
    staffId: 'AS00001',
    firstName: 'Thabo',
    lastName: 'Molefe',
    fullName: 'Thabo Molefe',
    email: 'Thabo.Molefe@gcu.co.za',
    role: 'HR_PARTNER',
  },
  {
    staffId: 'AS00002',
    firstName: 'Neo',
    lastName: 'Zonke',
    fullName: 'Neo Zonke',
    email: 'Neo@gcu.co.za',
    role: 'HR_PARTNER',
  },
  {
    staffId: 'AS00003',
    firstName: 'Joe',
    lastName: 'Doe',
    fullName: 'Joe Doe',
    email: 'Joe.Doe@gcu.co.za',
    role: 'HR_PARTNER',
  },
  {
    staffId: 'AS00004',
    firstName: 'Lindiwe',
    lastName: 'Khumalo',
    fullName: 'Lindiwe Khumalo',
    email: 'Lindiwe.Khumalo@gcu.co.za',
    role: 'HR_PARTNER',
  },
  {
    staffId: 'AS00005',
    firstName: 'Sipho',
    lastName: 'Dlamini',
    fullName: 'Sipho Dlamini',
    email: 'Sipho.Dlamini@gcu.co.za',
    role: 'HR_PARTNER',
  },
  {
    staffId: 'AS00006',
    firstName: 'Nomsa',
    lastName: 'Mthembu',
    fullName: 'Nomsa Mthembu',
    email: 'Nomsa.Mthembu@gcu.co.za',
    role: 'HR_MANAGER',
  },
];

/** Look up an HR staff member by their staff ID */
export function getHrStaffById(staffId: string): HrStaffMember | undefined {
  return HR_STAFF_REGISTRY.find((s) => s.staffId === staffId);
}

/** Get all HR Partners (excluding managers) */
export function getHrPartners(): HrStaffMember[] {
  return HR_STAFF_REGISTRY.filter((s) => s.role === 'HR_PARTNER');
}

/** Check if a staff ID belongs to an HR Manager */
export function isHrManager(staffId: string): boolean {
  const member = getHrStaffById(staffId);
  return member?.role === 'HR_MANAGER';
}
