import React, { useState, useContext } from 'react';
import { Card, Container, Row, Col, Button, Form } from 'react-bootstrap';
import { AuthContext } from './AuthContext';
import { useLogin, useSignup, useForgotPassword } from './datamodel/useAuthQueries';
import { setAuthToken } from './datamodel/api';

export default function LandingPage() {
  return (
    <Container className="d-flex align-items-center justify-content-center min-vh-100">
      <Row className="g-4 w-100">
        <Col md={4}>
          <SignInCard />
        </Col>
        <Col md={4}>
          <PricingCard />
        </Col>
        <Col md={4}>
          <OpenSourceCard />
        </Col>
      </Row>
    </Container>
  );
}

function SignInCard() {
  const [mode, setMode] = useState('signin');  // 'signin' | 'signup' | 'forgot'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const { login: authLogin } = useContext(AuthContext);
  const loginMutation = useLogin();
  const signupMutation = useSignup();
  const forgotPasswordMutation = useForgotPassword();

  const handleSignIn = async (e) => {
    e.preventDefault();
    try {
      console.log('Attempting login with:', username);
      const result = await loginMutation.mutateAsync({ username, password });
      console.log('Login result:', result);
      setAuthToken(result.token);
      authLogin(result.user, result.token);
      console.log('Login successful, user:', result.user);
    } catch (error) {
      console.error('Login error:', error);
      alert('Login failed: ' + (error.response?.data?.detail || error.message));
    }
  };

  const handleSignUp = async (e) => {
    e.preventDefault();
    try {
      const result = await signupMutation.mutateAsync({ username, password });
      setAuthToken(result.token);
      authLogin(result.user, result.token);
    } catch (error) {
      alert('Signup failed');
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    try {
      await forgotPasswordMutation.mutateAsync({ email });
      alert('Password reset instructions sent!');
      setMode('signin');
    } catch (error) {
      alert('Failed to send reset email');
    }
  };

  return (
    <Card>
      <Card.Body>
        <Card.Title>
          {mode === 'signin' ? 'Sign In' : mode === 'signup' ? 'Sign Up' : 'Forgot Password'}
        </Card.Title>
        {mode === 'signin' && (
          <Form onSubmit={handleSignIn}>
            <Form.Group className="mb-3">
              <Form.Control
                type="text"
                placeholder="Username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                required
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Control
                type="password"
                placeholder="Password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
            </Form.Group>
            <Button type="submit" variant="primary" className="w-100">
              Sign In
            </Button>
            <div className="mt-2 text-center">
              <a href="#" onClick={(e) => { e.preventDefault(); setMode('forgot'); }}>
                Forgot password?
              </a>
            </div>
            <div className="mt-2 text-center">
              <a href="#" onClick={(e) => { e.preventDefault(); setMode('signup'); }}>
                Don't have an account? Sign up
              </a>
            </div>
          </Form>
        )}
        {mode === 'signup' && (
          <Form onSubmit={handleSignUp}>
            <Form.Group className="mb-3">
              <Form.Control
                type="text"
                placeholder="Username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                required
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Control
                type="password"
                placeholder="Password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
            </Form.Group>
            <Button type="submit" variant="primary" className="w-100">
              Sign Up
            </Button>
            <div className="mt-2 text-center">
              <a href="#" onClick={(e) => { e.preventDefault(); setMode('signin'); }}>
                Back to sign in
              </a>
            </div>
          </Form>
        )}
        {mode === 'forgot' && (
          <Form onSubmit={handleForgotPassword}>
            <Form.Group className="mb-3">
              <Form.Control
                type="email"
                placeholder="Email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
            </Form.Group>
            <Button type="submit" variant="primary" className="w-100">
              Reset Password
            </Button>
            <div className="mt-2 text-center">
              <a href="#" onClick={(e) => { e.preventDefault(); setMode('signin'); }}>
                Back to sign in
              </a>
            </div>
          </Form>
        )}
      </Card.Body>
    </Card>
  );
}

function PricingCard() {
  const [showSignup, setShowSignup] = useState(false);

  if (showSignup) {
    return <SignInCard />;
  }

  return (
    <Card>
      <Card.Body>
        <Card.Title>Pricing</Card.Title>
        <h3 className="text-center my-4">$10/month</h3>
        <ul>
          <li>100 credits included</li>
          <li>$0.10 per process run</li>
          <li>Unlimited projects</li>
          <li>Unlimited storage</li>
        </ul>
        <Button variant="success" className="w-100" onClick={() => setShowSignup(true)}>
          Sign Up Now
        </Button>
      </Card.Body>
    </Card>
  );
}

function OpenSourceCard() {
  return (
    <Card>
      <Card.Body>
        <Card.Title>Open Source</Card.Title>
        <p>Nagelfluh is open source and available on GitHub.</p>
        <Button
          variant="outline-primary"
          className="w-100 mb-2"
          onClick={() => window.open('https://github.com/nagelfluh/nagelfluh', '_blank')}
        >
          View on GitHub
        </Button>
        <hr />
        <h6>Deploy on Kubernetes</h6>
        <p className="small">Self-host Nagelfluh on your own infrastructure.</p>
        <Button
          variant="outline-secondary"
          className="w-100"
          onClick={() => window.open('https://github.com/nagelfluh/nagelfluh/docs/k8s', '_blank')}
        >
          Deployment Guide
        </Button>
      </Card.Body>
    </Card>
  );
}
