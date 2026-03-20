// Validation utilities for authentication
export const ValidationRules = {
  email: {
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    message: 'Invalid email address',
    minLength: 5,
    maxLength: 254,
  },
  password: {
    minLength: 8,
    maxLength: 128,
    hasUpperCase: /[A-Z]/,
    hasLowerCase: /[a-z]/,
    hasNumber: /[0-9]/,
    hasSpecialChar: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/,
  },
  name: {
    minLength: 2,
    maxLength: 100,
    pattern: /^[a-zA-Z\s'-]*$/,
    message: 'Name can only contain letters, spaces, hyphens, and apostrophes',
  },
};

export const validateEmail = (email) => {
  const errors = [];

  if (!email) {
    errors.push('Email is required');
    return errors;
  }

  if (email.length < ValidationRules.email.minLength) {
    errors.push('Email is too short');
  }

  if (email.length > ValidationRules.email.maxLength) {
    errors.push('Email is too long');
  }

  if (!ValidationRules.email.pattern.test(email)) {
    errors.push('Invalid email format');
  }

  // Check for common typos
  const commonDomains = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com'];
  const domain = email.split('@')[1];
  if (domain) {
    const typos = ['gmial.com', 'gmai.com', 'yahooo.com', 'outlo0k.com'];
    if (typos.includes(domain)) {
      errors.push('Did you mean ' + domain.replace(/0/, 'o') + '?');
    }
  }

  return errors;
};

export const validatePassword = (password) => {
  const errors = [];
  const warnings = [];

  if (!password) {
    errors.push('Password is required');
    return { errors, warnings };
  }

  if (password.length < ValidationRules.password.minLength) {
    errors.push(`Password must be at least ${ValidationRules.password.minLength} characters`);
  }

  if (password.length > ValidationRules.password.maxLength) {
    errors.push('Password is too long');
  }

  if (!ValidationRules.password.hasUpperCase.test(password)) {
    warnings.push('Add uppercase letters for better security');
  }

  if (!ValidationRules.password.hasLowerCase.test(password)) {
    warnings.push('Add lowercase letters for better security');
  }

  if (!ValidationRules.password.hasNumber.test(password)) {
    warnings.push('Add numbers for better security');
  }

  if (!ValidationRules.password.hasSpecialChar.test(password)) {
    warnings.push('Add special characters for better security');
  }

  // Check for common passwords
  const commonPasswords = ['password', '12345678', 'qwerty123', 'abc123456', 'password123'];
  if (commonPasswords.some(common => password.toLowerCase().includes(common))) {
    errors.push('This password is too common. Please choose a stronger password');
  }

  return { errors, warnings };
};

export const validateName = (name) => {
  const errors = [];

  if (!name) {
    errors.push('Name is required');
    return errors;
  }

  if (name.trim().length < ValidationRules.name.minLength) {
    errors.push(`Name must be at least ${ValidationRules.name.minLength} characters`);
  }

  if (name.length > ValidationRules.name.maxLength) {
    errors.push('Name is too long');
  }

  if (!ValidationRules.name.pattern.test(name)) {
    errors.push(ValidationRules.name.message);
  }

  return errors;
};

export const getPasswordStrength = (password) => {
  if (!password) return 0;

  let strength = 0;

  if (password.length >= 8) strength++;
  if (password.length >= 12) strength++;
  if (ValidationRules.password.hasUpperCase.test(password)) strength++;
  if (ValidationRules.password.hasLowerCase.test(password)) strength++;
  if (ValidationRules.password.hasNumber.test(password)) strength++;
  if (ValidationRules.password.hasSpecialChar.test(password)) strength++;

  return Math.min(strength, 5); // 0-5 scale
};

export const getPasswordStrengthLabel = (strength) => {
  if (strength === 0) return 'Very Weak';
  if (strength === 1) return 'Weak';
  if (strength === 2) return 'Fair';
  if (strength === 3) return 'Good';
  if (strength === 4) return 'Strong';
  if (strength === 5) return 'Very Strong';
};

export const sanitizeInput = (input) => {
  return input.trim().replace(/[<>]/g, '');
};
