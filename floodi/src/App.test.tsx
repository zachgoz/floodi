import React from 'react';
import { render, screen } from '@testing-library/react';
import App from './App';
import { AuthProvider } from 'src/contexts/AuthContext';

test('renders without crashing and displays FloodCast tab label', () => {
  const { baseElement } = render(
    <AuthProvider>
      <App />
    </AuthProvider>
  );
  expect(baseElement).toBeDefined();
  expect(screen.getAllByText('FloodCast').length).toBeGreaterThanOrEqual(2);
  expect(screen.getByText('Alerts')).toBeInTheDocument();
  expect(screen.getByText('Help')).toBeInTheDocument();
});
