import { Location } from "@angular/common";
import { ChangeDetectorRef, Component, NgZone, OnDestroy, OnInit } from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";
import { first } from "rxjs/operators";

import { CiphersComponent as BaseCiphersComponent } from "jslib-angular/components/ciphers.component";
import { BroadcasterService } from "jslib-common/abstractions/broadcaster.service";
import { CipherService } from "jslib-common/abstractions/cipher.service";
import { CollectionService } from "jslib-common/abstractions/collection.service";
import { FolderService } from "jslib-common/abstractions/folder.service";
import { I18nService } from "jslib-common/abstractions/i18n.service";
import { PlatformUtilsService } from "jslib-common/abstractions/platformUtils.service";
import { SearchService } from "jslib-common/abstractions/search.service";
import { CipherType } from "jslib-common/enums/cipherType";
import { TreeNode } from "jslib-common/models/domain/treeNode";
import { CipherView } from "jslib-common/models/view/cipherView";
import { CollectionView } from "jslib-common/models/view/collectionView";
import { FolderView } from "jslib-common/models/view/folderView";

import { BrowserComponentState } from "src/models/browserComponentState";

import { BrowserApi } from "../../browser/browserApi";
import { StateService } from "../../services/abstractions/state.service";
import { PopupUtilsService } from "../services/popup-utils.service";

const ComponentId = "CiphersComponent";

@Component({
  selector: "app-vault-ciphers",
  templateUrl: "ciphers.component.html",
})
export class CiphersComponent extends BaseCiphersComponent implements OnInit, OnDestroy {
  groupingTitle: string;
  state: BrowserComponentState;
  folderId: string = null;
  collectionId: string = null;
  type: CipherType = null;
  nestedFolders: TreeNode<FolderView>[];
  nestedCollections: TreeNode<CollectionView>[];
  searchTypeSearch = false;

  private selectedTimeout: number;
  private preventSelected = false;
  private applySavedState = true;
  private scrollingContainer = "cdk-virtual-scroll-viewport";

  constructor(
    searchService: SearchService,
    private route: ActivatedRoute,
    private router: Router,
    private location: Location,
    private ngZone: NgZone,
    private broadcasterService: BroadcasterService,
    private changeDetectorRef: ChangeDetectorRef,
    private stateService: StateService,
    private popupUtils: PopupUtilsService,
    private i18nService: I18nService,
    private folderService: FolderService,
    private collectionService: CollectionService,
    private platformUtilsService: PlatformUtilsService,
    private cipherService: CipherService
  ) {
    super(searchService);
    this.applySavedState =
      (window as any).previousPopupUrl != null &&
      !(window as any).previousPopupUrl.startsWith("/ciphers");
  }

  async ngOnInit() {
    this.searchTypeSearch = !this.platformUtilsService.isSafari();
    this.route.queryParams.pipe(first()).subscribe(async (params) => {
      if (this.applySavedState) {
        this.state = await this.stateService.getBrowserCipherComponentState();
        if (this.state?.searchText) {
          this.searchText = this.state.searchText;
        }
      }

      if (params.deleted) {
        this.groupingTitle = this.i18nService.t("trash");
        this.searchPlaceholder = this.i18nService.t("searchTrash");
        await this.load(null, true);
      } else if (params.type) {
        this.searchPlaceholder = this.i18nService.t("searchType");
        this.type = parseInt(params.type, null);
        switch (this.type) {
          case CipherType.Login:
            this.groupingTitle = this.i18nService.t("logins");
            break;
          case CipherType.Card:
            this.groupingTitle = this.i18nService.t("cards");
            break;
          case CipherType.Identity:
            this.groupingTitle = this.i18nService.t("identities");
            break;
          case CipherType.SecureNote:
            this.groupingTitle = this.i18nService.t("secureNotes");
            break;
          default:
            break;
        }
        await this.load((c) => c.type === this.type);
      } else if (params.folderId) {
        this.folderId = params.folderId === "none" ? null : params.folderId;
        this.searchPlaceholder = this.i18nService.t("searchFolder");
        if (this.folderId != null) {
          const folderNode = await this.folderService.getNested(this.folderId);
          if (folderNode != null && folderNode.node != null) {
            this.groupingTitle = folderNode.node.name;
            this.nestedFolders =
              folderNode.children != null && folderNode.children.length > 0
                ? folderNode.children
                : null;
          }
        } else {
          this.groupingTitle = this.i18nService.t("noneFolder");
        }
        await this.load((c) => c.folderId === this.folderId);
      } else if (params.collectionId) {
        this.collectionId = params.collectionId;
        this.searchPlaceholder = this.i18nService.t("searchCollection");
        const collectionNode = await this.collectionService.getNested(this.collectionId);
        if (collectionNode != null && collectionNode.node != null) {
          this.groupingTitle = collectionNode.node.name;
          this.nestedCollections =
            collectionNode.children != null && collectionNode.children.length > 0
              ? collectionNode.children
              : null;
        }
        await this.load(
          (c) => c.collectionIds != null && c.collectionIds.indexOf(this.collectionId) > -1
        );
      } else {
        this.groupingTitle = this.i18nService.t("allItems");
        await this.load();
      }

      if (this.applySavedState && this.state != null) {
        window.setTimeout(
          () =>
            this.popupUtils.setContentScrollY(window, this.state.scrollY, this.scrollingContainer),
          0
        );
      }
      await this.stateService.setBrowserCipherComponentState(null);
    });

    this.broadcasterService.subscribe(ComponentId, (message: any) => {
      this.ngZone.run(async () => {
        switch (message.command) {
          case "syncCompleted":
            if (message.successfully) {
              window.setTimeout(() => {
                this.refresh();
              }, 500);
            }
            break;
          default:
            break;
        }

        this.changeDetectorRef.detectChanges();
      });
    });
  }

  ngOnDestroy() {
    this.saveState();
    this.broadcasterService.unsubscribe(ComponentId);
  }

  selectCipher(cipher: CipherView) {
    this.selectedTimeout = window.setTimeout(() => {
      if (!this.preventSelected) {
        super.selectCipher(cipher);
        this.router.navigate(["/view-cipher"], { queryParams: { cipherId: cipher.id } });
      }
      this.preventSelected = false;
    }, 200);
  }

  selectFolder(folder: FolderView) {
    if (folder.id != null) {
      this.router.navigate(["/ciphers"], { queryParams: { folderId: folder.id } });
    }
  }

  selectCollection(collection: CollectionView) {
    this.router.navigate(["/ciphers"], { queryParams: { collectionId: collection.id } });
  }

  async launchCipher(cipher: CipherView) {
    if (cipher.type !== CipherType.Login || !cipher.login.canLaunch) {
      return;
    }

    if (this.selectedTimeout != null) {
      window.clearTimeout(this.selectedTimeout);
    }
    this.preventSelected = true;
    await this.cipherService.updateLastLaunchedDate(cipher.id);
    BrowserApi.createNewTab(cipher.login.launchUri);
    if (this.popupUtils.inPopup(window)) {
      BrowserApi.closePopup(window);
    }
  }

  addCipher() {
    if (this.deleted) {
      return false;
    }
    super.addCipher();
    this.router.navigate(["/add-cipher"], {
      queryParams: {
        folderId: this.folderId,
        type: this.type,
        collectionId: this.collectionId,
      },
    });
  }

  back() {
    (window as any).routeDirection = "b";
    this.location.back();
  }

  showGroupings() {
    return (
      !this.isSearching() &&
      ((this.nestedFolders && this.nestedFolders.length) ||
        (this.nestedCollections && this.nestedCollections.length))
    );
  }

  private async saveState() {
    this.state = {
      scrollY: this.popupUtils.getContentScrollY(window, this.scrollingContainer),
      searchText: this.searchText,
    };
    await this.stateService.setBrowserCipherComponentState(this.state);
  }
}
