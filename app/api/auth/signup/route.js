// Compatibilitate pentru clienți vechi: signup folosește același flow
// production-ready ca register, cu email confirmation obligatoriu.
export { POST } from '@/app/api/auth/register/route';
