/**
 * CommentList tests
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { CommentList } from 'src/components/comments/CommentList';
import { CommentModel } from 'src/components/comments/CommentItem';

describe('CommentList', () => {
  const comments: CommentModel[] = [
    {
      id: '1',
      author: { displayName: 'Alice' },
      content: 'Hello',
      createdAt: new Date().toISOString(),
      meta: {},
    },
    {
      id: '2',
      author: { displayName: 'Bob' },
      content: 'World',
      createdAt: new Date().toISOString(),
      meta: {},
    },
  ];

  it('renders list with comments', () => {
    render(<CommentList comments={comments} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });
});

