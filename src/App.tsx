import React from 'react';
import { IonApp } from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import { Route, Redirect } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Home from './pages/Home';

const client = new QueryClient();

const App: React.FC = () => (
  <QueryClientProvider client={client}>
    <IonApp>
      <IonReactRouter>
        <Route exact path="/">
          <Home />
        </Route>
        <Route exact path="*">
          <Redirect to="/" />
        </Route>
      </IonReactRouter>
    </IonApp>
  </QueryClientProvider>
);

export default App;
