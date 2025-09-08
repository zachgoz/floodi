# Tab2 Refactoring Architecture Plan

## Component Decomposition Strategy

### 1. Core Components

#### **ChartViewer** (`ChartViewer.tsx`)
- **Responsibility**: SVG chart rendering with interactive features
- **Props**: Data series, domain, threshold, formatting options
- **Features**: 
  - Hover interactions and tooltips
  - Responsive sizing with ResizeObserver
  - Flood segment highlighting
  - Professional SVG rendering

#### **SettingsModal** (`SettingsModal.tsx`)
- **Responsibility**: Main settings container and modal management
- **Props**: isOpen, onDismiss, configuration state
- **Features**:
  - Professional IonModal implementation
  - Organized section layout
  - Proper accessibility attributes

#### **StationSelector** (`StationSelector.tsx`)  
- **Responsibility**: Station selection with search functionality
- **Props**: Station data, selection handlers, validation
- **Features**:
  - IonSearchbar instead of custom input + portal
  - Professional autocomplete with IonList
  - Proper loading states and error handling

#### **FloodSettings** (`FloodSettings.tsx`)
- **Responsibility**: Threshold and surge offset configuration  
- **Props**: Threshold, offset settings, change handlers
- **Features**:
  - IonInput for threshold values
  - IonSegment for offset mode selection
  - Clear validation and error states

#### **TimeSettings** (`TimeSettings.tsx`)
- **Responsibility**: Time range and timezone controls
- **Props**: Time configuration, change handlers
- **Features**:
  - IonSegment for relative/absolute mode
  - IonSelect for time windows
  - IonDatetime for absolute ranges
  - Professional timezone handling

#### **DisplaySettings** (`DisplaySettings.tsx`)
- **Responsibility**: Chart display options
- **Props**: Display preferences, toggle handlers
- **Features**:
  - IonToggle for delta display
  - Future expandability for other display options

### 2. Custom Hooks

#### **useChartData** (`hooks/useChartData.ts`)
- **Responsibility**: Data fetching, processing, and series generation
- **Returns**: Observed, predicted, adjusted data with loading states
- **Features**:
  - Consolidated API calls
  - Error handling
  - Data transformation and filtering
  - Memoized computations

#### **useSettingsStorage** (`hooks/useSettingsStorage.ts`)
- **Responsibility**: Centralized localStorage management
- **Returns**: Settings state and update functions
- **Features**:
  - Type-safe configuration object
  - Automatic persistence
  - Default value handling
  - Error-safe operations

#### **useStationSearch** (`hooks/useStationSearch.ts`)
- **Responsibility**: Station search and validation logic
- **Returns**: Search results, loading states, selection handlers
- **Features**:
  - Debounced search
  - Caching with expiration
  - Professional error handling

#### **useChartInteraction** (`hooks/useChartInteraction.ts`)
- **Responsibility**: Chart hover, tooltips, and user interaction
- **Returns**: Hover state, interaction handlers, tooltip data
- **Features**:
  - Optimized pointer tracking
  - Nearest point calculations
  - Responsive tooltip positioning

### 3. Professional Ionic Patterns

#### **Replace Custom Implementations**
- ✅ `createPortal` dropdown → `IonSearchbar` + `IonList`
- ✅ `.textInput` CSS → `IonInput` with proper Ionic styling
- ✅ Manual modal → `IonModal` with proper lifecycle
- ✅ Custom autocomplete → `IonSearchbar` with filtering
- ✅ Manual positioning → Ionic's built-in layout system

#### **CSS Architecture Improvements**
- ✅ Replace manual light/dark mode → Ionic CSS variables
- ✅ Remove hardcoded dimensions → Responsive Ionic grid
- ✅ Use Ionic spacing utilities instead of custom margins
- ✅ Leverage Ionic's design tokens for consistency

### 4. State Management Structure

```typescript
interface AppConfiguration {
  station: {
    id: string;
    name: string;
    state?: string;
  };
  threshold: number;
  offset: {
    mode: 'auto' | 'manual';
    value: string;
  };
  timeRange: {
    mode: 'relative' | 'absolute';
    lookbackH: number;
    lookaheadH: number;
    absStart: string;
    absEnd: string;
  };
  display: {
    timezone: 'local' | 'gmt';
    showDelta: boolean;
  };
}
```

### 5. File Structure
```
floodi/src/components/Tab2/
├── ARCHITECTURE.md
├── index.ts
├── ChartViewer.tsx
├── SettingsModal.tsx
├── StationSelector.tsx
├── FloodSettings.tsx
├── TimeSettings.tsx
├── DisplaySettings.tsx
├── hooks/
│   ├── useChartData.ts
│   ├── useSettingsStorage.ts
│   ├── useStationSearch.ts
│   └── useChartInteraction.ts
├── types/
│   └── index.ts
└── styles/
    └── Tab2.css (refactored)
```

### 6. Migration Strategy

1. **Phase 1**: Create hook structure and extract state management
2. **Phase 2**: Build individual components with proper Ionic patterns  
3. **Phase 3**: Replace custom implementations (portals, inputs, modals)
4. **Phase 4**: Refactor CSS to use Ionic design system
5. **Phase 5**: Add comprehensive JSDoc documentation
6. **Phase 6**: Integration testing and validation

### 7. Benefits

- ✅ **Maintainability**: Single responsibility components
- ✅ **Professional Appearance**: Proper Ionic design patterns
- ✅ **Performance**: Optimized re-renders and memoization
- ✅ **Accessibility**: Built-in ARIA support from Ionic components
- ✅ **Consistency**: Unified design language across the app
- ✅ **Testability**: Isolated, focused components
- ✅ **Reusability**: Components can be used elsewhere in the app