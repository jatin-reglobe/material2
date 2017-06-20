/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {
  Attribute,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ContentChild,
  ContentChildren,
  Directive,
  ElementRef,
  Input,
  IterableChangeRecord,
  IterableDiffer,
  IterableDiffers,
  NgIterable,
  QueryList,
  Renderer2,
  ViewChild,
  ViewContainerRef,
  ViewEncapsulation
} from '@angular/core';
import {CollectionViewer, DataSource} from './data-source';
import {BaseRowDef, CdkCellOutlet, CdkHeaderRowDef, CdkRowDef} from './row';
import {CdkCellDef, CdkColumnDef, CdkHeaderCellDef} from './cell';
import {Observable} from 'rxjs/Observable';
import {BehaviorSubject} from 'rxjs/BehaviorSubject';
import 'rxjs/add/operator/let';
import 'rxjs/add/operator/debounceTime';
import 'rxjs/add/observable/combineLatest';
import {Subscription} from 'rxjs/Subscription';
import {Subject} from 'rxjs/Subject';

/**
 * Provides a handle for the table to grab the view container's ng-container to insert data rows.
 * @docs-private
 */
@Directive({selector: '[rowPlaceholder]'})
export class RowPlaceholder {
  constructor(public viewContainer: ViewContainerRef) { }
}

/**
 * Provides a handle for the table to grab the view container's ng-container to insert the header.
 * @docs-private
 */
@Directive({selector: '[headerRowPlaceholder]'})
export class HeaderRowPlaceholder {
  constructor(public viewContainer: ViewContainerRef) { }
}

/**
 * A data table that connects with a data source to retrieve data of type T and renders
 * a header row and data rows. Updates the rows when new data is provided by the data source.
 */
@Component({
  selector: 'cdk-table',
  template: `
    <ng-container headerRowPlaceholder></ng-container>
    <ng-container rowPlaceholder></ng-container>
  `,
  host: {
    'class': 'cdk-table',
  },
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CdkTable<T> implements CollectionViewer {
  /** Subject that emits when the component has been destroyed. */
  private _onDestroy = new Subject<void>();

  /** Flag set to true after the component has been initialized. */
  private _isViewInitialized = false;

  /** Latest data provided by the data source through the connect interface. */
  private _data: NgIterable<T> = [];

  /** Subscription that listens for the data provided by the data source. */
  private _renderChangeSubscription: Subscription;

  /**
   * Map of all the user's defined columns identified by name.
   * Contains the header and data-cell templates.
   */
  private _columnDefinitionsByName = new Map<string,  CdkColumnDef>();

  /** Differ used to find the changes in the data provided by the data source. */
  private _dataDiffer: IterableDiffer<T> = null;

  // TODO(andrewseguin): Remove max value as the end index
  //   and instead calculate the view on init and scroll.
  /**
   * Stream containing the latest information on what rows are being displayed on screen.
   * Can be used by the data source to as a heuristic of what data should be provided.
   */
  viewChange =
      new BehaviorSubject<{start: number, end: number}>({start: 0, end: Number.MAX_VALUE});

  /**
   * Provides a stream containing the latest data array to render. Influenced by the table's
   * stream of view window (what rows are currently on screen).
   */
  @Input()
  get dataSource(): DataSource<T> { return this._dataSource; }
  set dataSource(dataSource: DataSource<T>) {
    if (this._dataSource !== dataSource) {
      this._switchDataSource(dataSource);
    }
  }
  private _dataSource: DataSource<T>;

  // Placeholders within the table's template where the header and data rows will be inserted.
  @ViewChild(RowPlaceholder) _rowPlaceholder: RowPlaceholder;
  @ViewChild(HeaderRowPlaceholder) _headerRowPlaceholder: HeaderRowPlaceholder;

  /**
   * The column definitions provided by the user that contain what the header and cells should
   * render for each column.
   */
  @ContentChildren(CdkColumnDef) _columnDefinitions: QueryList<CdkColumnDef>;

  /** Template used as the header container. */
  @ContentChild(CdkHeaderRowDef) _headerDefinition: CdkHeaderRowDef;

  /** Set of templates that used as the data row containers. */
  @ContentChildren(CdkRowDef) _rowDefinitions: QueryList<CdkRowDef>;

  constructor(private readonly _differs: IterableDiffers,
              private readonly _changeDetectorRef: ChangeDetectorRef,
              elementRef: ElementRef,
              renderer: Renderer2,
              @Attribute('role') role: string) {
    // Show the stability warning of the data-table only if it doesn't run inside of jasmine.
    // This is just temporary and should reduce warnings when running the tests.
    if (!(typeof window !== 'undefined' && window['jasmine'])) {
      console.warn('The data table is still in active development ' +
          'and should be considered unstable.');
    }

    if (!role) {
      renderer.setAttribute(elementRef.nativeElement, 'role', 'grid');
    }

    // TODO(andrewseguin): Add trackby function input.
    // Find and construct an iterable differ that can be used to find the diff in an array.
    this._dataDiffer = this._differs.find(this._data).create();
  }

  ngOnDestroy() {
    this._onDestroy.next();
    this._onDestroy.complete();
  }

  ngOnInit() {
    // TODO(andrewseguin): Setup a listener for scroll events
    //   and emit the calculated view to this.viewChange
  }

  ngAfterContentInit() {
    // TODO(andrewseguin): Throw an error if two columns share the same name
    this._columnDefinitions.forEach(columnDef => {
      this._columnDefinitionsByName.set(columnDef.name, columnDef);
    });

    // Re-render the rows if any of their columns change.
    // TODO(andrewseguin): Determine how to only re-render the rows that have their columns changed.
    Observable.merge(...this._rowDefinitions.map(rowDef => rowDef.columnsChange))
        .takeUntil(this._onDestroy)
        .subscribe(() => {
          // Reset the data to an empty array so that renderRowChanges will re-render all new rows.
          this._rowPlaceholder.viewContainer.clear();
          this._dataDiffer.diff([]);
          this._renderRowChanges();
        });

    // Re-render the header row if the columns change
    this._headerDefinition.columnsChange
        .takeUntil(this._onDestroy)
        .subscribe(() => {
          this._headerRowPlaceholder.viewContainer.clear();
          this._renderHeaderRow();
        });
  }

  ngAfterViewInit() {
    this._renderHeaderRow();

    if (this.dataSource) {
      this._observeRenderChanges();
    }

    this._isViewInitialized = true;
  }

  /**
   * Switch to the provided data source by resetting the data and unsubscribing from the current
   * render change subscription if one exists. If the data source is null, interpret this by
   * clearing the row placeholder. Otherwise start listening for new data.
   */
  private _switchDataSource(dataSource: DataSource<T>) {
    this._data = [];
    this._dataSource = dataSource;

    if (this._isViewInitialized) {
      if (this._renderChangeSubscription) {
        this._renderChangeSubscription.unsubscribe();
      }

      if (this._dataSource) {
        this._observeRenderChanges();
      } else {
        this._rowPlaceholder.viewContainer.clear();
      }
    }
  }

  /** Set up a subscription for the data provided by the data source. */
  private _observeRenderChanges() {
    this._renderChangeSubscription = this.dataSource.connect(this)
        .takeUntil(this._onDestroy)
        .subscribe(data => {
          this._data = data;
          this._renderRowChanges();
        });
  }

  /**
   * Create the embedded view for the header template and place it in the header row view container.
   */
  private _renderHeaderRow() {
    const cells = this._getHeaderCellTemplatesForRow(this._headerDefinition);
    if (!cells.length) { return; }

    // TODO(andrewseguin): add some code to enforce that exactly
    //   one CdkCellOutlet was instantiated as a result
    //   of `createEmbeddedView`.
    this._headerRowPlaceholder.viewContainer
        .createEmbeddedView(this._headerDefinition.template, {cells});
    CdkCellOutlet.mostRecentCellOutlet.cells = cells;
    CdkCellOutlet.mostRecentCellOutlet.context = {};

    this._changeDetectorRef.markForCheck();
  }

  /** Check for changes made in the data and render each change (row added/removed/moved). */
  private _renderRowChanges() {
    const changes = this._dataDiffer.diff(this._data);
    if (!changes) { return; }

    changes.forEachOperation(
        (item: IterableChangeRecord<any>, adjustedPreviousIndex: number, currentIndex: number) => {
          if (item.previousIndex == null) {
            this._insertRow(this._data[currentIndex], currentIndex);
          } else if (currentIndex == null) {
            this._rowPlaceholder.viewContainer.remove(adjustedPreviousIndex);
          } else {
            const view = this._rowPlaceholder.viewContainer.get(adjustedPreviousIndex);
            this._rowPlaceholder.viewContainer.move(view, currentIndex);
          }
        });
  }

  /**
   * Create the embedded view for the data row template and place it in the correct index location
   * within the data row view container.
   */
  private _insertRow(rowData: T, index: number) {
    // TODO(andrewseguin): Add when predicates to the row definitions
    //   to find the right template to used based on
    //   the data rather than choosing the first row definition.
    const row = this._rowDefinitions.first;

    // TODO(andrewseguin): Add more context, such as first/last/isEven/etc
    const context = {$implicit: rowData};

    // TODO(andrewseguin): add some code to enforce that exactly one
    //   CdkCellOutlet was instantiated as a result  of `createEmbeddedView`.
    this._rowPlaceholder.viewContainer.createEmbeddedView(row.template, context, index);

    // Insert empty cells if there is no data to improve rendering time.
    CdkCellOutlet.mostRecentCellOutlet.cells = rowData ? this._getCellTemplatesForRow(row) : [];
    CdkCellOutlet.mostRecentCellOutlet.context = context;

    this._changeDetectorRef.markForCheck();
  }

  /**
   * Returns the cell template definitions to insert into the header
   * as defined by its list of columns to display.
   */
  private _getHeaderCellTemplatesForRow(headerDef: CdkHeaderRowDef): CdkHeaderCellDef[] {
    return headerDef.columns.map(columnId => {
      // TODO(andrewseguin): Throw an error if there is no column with this columnId
      return this._columnDefinitionsByName.get(columnId).headerCell;
    });
  }

  /**
   * Returns the cell template definitions to insert in the provided row
   * as defined by its list of columns to display.
   */
  private _getCellTemplatesForRow(rowDef: CdkRowDef): CdkCellDef[] {
    return rowDef.columns.map(columnId => {
      // TODO(andrewseguin): Throw an error if there is no column with this columnId
      return this._columnDefinitionsByName.get(columnId).cell;
    });
  }
}
