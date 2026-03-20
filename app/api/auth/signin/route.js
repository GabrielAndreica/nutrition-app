import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Simple in-memory rate limiting (in production, use Redis or database)
const loginAttempts = new Map();
const MAX_ATTEMPTS = 100;
const LOCKOUT_TIME = 15 * 60 * 1000; // 15 minutes in milliseconds

const validateEmail = (email) => {
  if (!email) return 'Email is required';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Invalid email format';
  return null;
};

const validatePassword = (password) => {
  if (!password) return 'Password is required';
  return null;
};

const sanitizeInput = (input) => {
  return input.trim().replace(/[<>]/g, '');
};

const checkRateLimit = (email) => {
  const attempt = loginAttempts.get(email);
  
  if (attempt) {
    if (attempt.count >= MAX_ATTEMPTS) {
      const timePassed = Date.now() - attempt.lastAttempt;
      
      if (timePassed < LOCKOUT_TIME) {
        const remainingTime = Math.ceil((LOCKOUT_TIME - timePassed) / 1000);
        return {
          limited: true,
          message: `Too many failed attempts. Please try again in ${remainingTime} seconds.`,
        };
      } else {
        // Reset after lockout period
        loginAttempts.delete(email);
        return { limited: false };
      }
    }
  }
  
  return { limited: false };
};

const recordFailedAttempt = (email) => {
  const attempt = loginAttempts.get(email);
  
  if (attempt) {
    attempt.count += 1;
    attempt.lastAttempt = Date.now();
  } else {
    loginAttempts.set(email, {
      count: 1,
      lastAttempt: Date.now(),
    });
  }
};

const recordSuccessfulLogin = (email) => {
  loginAttempts.delete(email);
};

export async function POST(request) {
  try {
    const body = await request.json();

    let { email, password } = body;

    // Sanitize inputs
    email = sanitizeInput(email || '');
    password = password || '';

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

    // Check rate limiting
    const rateLimit = checkRateLimit(email.toLowerCase());
    if (rateLimit.limited) {
      return new Response(
        JSON.stringify({ 
          error: rateLimit.message,
          code: 'RATE_LIMITED'
        }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get user from database
    const { data: user, error: dbError } = await supabase
      .from('users')
      .select('id, name, email, password')
      .eq('email', email.toLowerCase())
      .single();

    if (dbError || !user) {
      recordFailedAttempt(email.toLowerCase());
      
      return new Response(
        JSON.stringify({ 
          error: 'Invalid email or password',
          code: 'INVALID_CREDENTIALS'
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Compare passwords
    let passwordMatch;
    try {
      passwordMatch = await bcrypt.compare(password, user.password);
    } catch (compareError) {
      console.error('Password comparison error:', compareError);
      return new Response(
        JSON.stringify({ error: 'Authentication failed. Please try again.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!passwordMatch) {
      recordFailedAttempt(email.toLowerCase());
      
      return new Response(
        JSON.stringify({ 
          error: 'Invalid email or password',
          code: 'INVALID_CREDENTIALS'
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Successful login
    recordSuccessfulLogin(email.toLowerCase());

    // Generate JWT token
    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email,
        name: user.name 
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return new Response(
      JSON.stringify({ 
        message: 'Login successful',
        token,
        user: { 
          id: user.id, 
          name: user.name, 
          email: user.email 
        }
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Sign in error:', error);

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
