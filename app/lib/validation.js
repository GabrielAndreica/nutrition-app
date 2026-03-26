// Validation utilities for authentication
export const ValidationRules = {
  email: {
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    message: 'Format de email invalid',
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
    message: 'Numele poate conține doar litere, spații, cratime și apostroafe',
  },
};

export const validateEmail = (email) => {
  const errors = [];

  if (!email) {
    errors.push('Adresa de email este obligatorie');
    return errors;
  }

  if (email.length < ValidationRules.email.minLength) {
    errors.push('Adresa de email este prea scurtă');
  }

  if (email.length > ValidationRules.email.maxLength) {
    errors.push('Adresa de email este prea lungă');
  }

  if (!ValidationRules.email.pattern.test(email)) {
    errors.push('Format de email invalid');
  }

  // Check for common typos
  const commonDomains = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com'];
  const domain = email.split('@')[1];
  if (domain) {
    const typos = ['gmial.com', 'gmai.com', 'yahooo.com', 'outlo0k.com'];
    if (typos.includes(domain)) {
      errors.push('Ai vrut să spui ' + domain.replace(/0/, 'o') + '?');
    }
  }

  return errors;
};

export const validatePassword = (password) => {
  const errors = [];
  const warnings = [];

  if (!password) {
    errors.push('Parola este obligatorie');
    return { errors, warnings };
  }

  if (password.length < ValidationRules.password.minLength) {
    errors.push(`Parola trebuie să aibă cel puțin ${ValidationRules.password.minLength} caractere`);
  }

  if (password.length > ValidationRules.password.maxLength) {
    errors.push('Parola este prea lungă');
  }

  if (!ValidationRules.password.hasUpperCase.test(password)) {
    warnings.push('Adaugă litere mari pentru mai multă securitate');
  }

  if (!ValidationRules.password.hasLowerCase.test(password)) {
    warnings.push('Adaugă litere mici pentru mai multă securitate');
  }

  if (!ValidationRules.password.hasNumber.test(password)) {
    warnings.push('Adaugă cifre pentru mai multă securitate');
  }

  if (!ValidationRules.password.hasSpecialChar.test(password)) {
    warnings.push('Adaugă caractere speciale pentru mai multă securitate');
  }

  // Check for common passwords
  const commonPasswords = ['password', '12345678', 'qwerty123', 'abc123456', 'password123'];
  if (commonPasswords.some(common => password.toLowerCase().includes(common))) {
    errors.push('Această parolă este prea comună. Alege o parolă mai puternică');
  }

  return { errors, warnings };
};

export const validateName = (name) => {
  const errors = [];

  if (!name) {
    errors.push('Numele este obligatoriu');
    return errors;
  }

  if (name.trim().length < ValidationRules.name.minLength) {
    errors.push(`Numele trebuie să aibă cel puțin ${ValidationRules.name.minLength} caractere`);
  }

  if (name.length > ValidationRules.name.maxLength) {
    errors.push('Numele este prea lung');
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
  if (strength === 0) return 'Foarte slabă';
  if (strength === 1) return 'Slabă';
  if (strength === 2) return 'Acceptabilă';
  if (strength === 3) return 'Bună';
  if (strength === 4) return 'Puternică';
  if (strength === 5) return 'Foarte puternică';
};

export const sanitizeInput = (input) => {
  return input.trim().replace(/[<>]/g, '');
};
