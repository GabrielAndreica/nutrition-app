import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcrypt';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Validation rules
const ValidationRules = {
  email: {
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    minLength: 5,
    maxLength: 254,
  },
  password: {
    minLength: 8,
    maxLength: 128,
  },
  name: {
    minLength: 2,
    maxLength: 100,
    pattern: /^[a-zA-Z\s'-]*$/,
  },
};

const validateEmail = (email) => {
  if (!email) return 'Email is required';
  if (email.length < ValidationRules.email.minLength) return 'Email is too short';
  if (email.length > ValidationRules.email.maxLength) return 'Email is too long';
  if (!ValidationRules.email.pattern.test(email)) return 'Invalid email format';
  return null;
};

const validatePassword = (password) => {
  if (!password) return 'Password is required';
  if (password.length < ValidationRules.password.minLength) {
    return `Password must be at least ${ValidationRules.password.minLength} characters`;
  }
  if (password.length > ValidationRules.password.maxLength) {
    return 'Password is too long';
  }

  // Check for common weak passwords
  const commonPasswords = ['password', '12345678', 'qwerty123', 'abc123456', 'password123'];
  if (commonPasswords.some(common => password.toLowerCase().includes(common))) {
    return 'This password is too common. Please choose a stronger password';
  }

  return null;
};

const validateName = (name) => {
  if (!name) return 'Name is required';
  const trimmed = name.trim();
  if (trimmed.length < ValidationRules.name.minLength) {
    return `Name must be at least ${ValidationRules.name.minLength} characters`;
  }
  if (trimmed.length > ValidationRules.name.maxLength) return 'Name is too long';
  if (!ValidationRules.name.pattern.test(trimmed)) {
    return 'Name can only contain letters, spaces, hyphens, and apostrophes';
  }
  return null;
};

const sanitizeInput = (input) => {
  return input.trim().replace(/[<>]/g, '');
};

export async function POST(request) {
  try {
    const body = await request.json();

    let { name, email, password } = body;

    // Sanitize inputs
    name = sanitizeInput(name || '');
    email = sanitizeInput(email || '');
    password = password || '';

    // Validate name
    const nameError = validateName(name);
    if (nameError) {
      return new Response(
        JSON.stringify({ error: nameError }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate email
    const emailError = validateEmail(email);
    if (emailError) {
      return new Response(
        JSON.stringify({ error: emailError }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate password
    const passwordError = validatePassword(password);
    if (passwordError) {
      return new Response(
        JSON.stringify({ error: passwordError }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Check if user already exists
    const { data: existingUser, error: checkError } = await supabase
      .from('users')
      .select('email')
      .eq('email', email.toLowerCase())
      .single();

    if (existingUser) {
      return new Response(
        JSON.stringify({ 
          error: 'Email already registered. Please sign in instead.',
          code: 'EMAIL_EXISTS'
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Hash password with bcrypt
    let hashedPassword;
    try {
      hashedPassword = await bcrypt.hash(password, 12);
    } catch (hashError) {
      console.error('Bcrypt hashing error:', hashError);
      return new Response(
        JSON.stringify({ error: 'Failed to process password. Please try again.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Create user in database
    const { data, error } = await supabase
      .from('users')
      .insert([
        {
          name: name.trim(),
          email: email.toLowerCase(),
          password: hashedPassword,
          created_at: new Date().toISOString(),
        },
      ])
      .select('id, name, email, created_at');

    if (error) {
      console.error('Database error:', error);
      
      // Handle duplicate email error from database
      if (error.code === '23505') {
        return new Response(
          JSON.stringify({ 
            error: 'Email already registered. Please sign in instead.',
            code: 'EMAIL_EXISTS'
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ error: 'Failed to create account. Please try again.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!data || data.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Failed to create account. Please try again.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ 
        message: 'Account created successfully',
        user: {
          id: data[0].id,
          name: data[0].name,
          email: data[0].email,
        }
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Sign up error:', error);
    
    // Handle JSON parse errors
    if (error instanceof SyntaxError) {
      return new Response(
        JSON.stringify({ error: 'Invalid request format' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Server error. Please try again later.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
